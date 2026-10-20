#!/usr/bin/env python3
"""Read-only, projected sources for local aggregation; importing does no I/O.

The dump reader accepts Navicat CREATE TABLE / INSERT ... VALUES syntax, not
arbitrary SQL expressions. It never executes SQL. Only requested value strings
are decoded (UTF-8); skipped strings and blobs stay in bounded binary buffers.
Numbers become int/float and SQL NULL becomes None. Selected blobs are rejected.

Consumers MUST exhaust the iterator before publishing aggregates: later tuples
or end-of-file can reveal truncation or missing tables after earlier rows were
yielded. Closing an iterator early deliberately skips this final validation.

mysql_rows is opt-in. It issues SELECT JSON_OBJECT only, with a quick, streaming
client. Connection options use an anonymous inherited pipe and passwords use
MYSQL_PWD, never command-line arguments or on-disk option files. No raw source
values, client errors, credentials, or internal hosts are logged by this module.
"""

from __future__ import annotations

import json
import math
import os
import re
import subprocess
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from typing import BinaryIO, NamedTuple

__all__ = ["SourceError", "dump_rows", "mysql_rows", "dump_metadata"]

_CHUNK_SIZE = 64 * 1024
_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_$]{0,63}\Z", re.ASCII)
_SPACE = re.compile(rb"[\x00-\x20]+")
_ATOM_END = re.compile(rb"[\x00-\x20(),;'\"`#/]|--(?=[\x00-\x20])")
_SKIP_SPECIAL = re.compile(rb"['\"`;#/\-]")
_QUOTE_SPECIAL = {
    ord("'"): re.compile(rb"['\\]"),
    ord('"'): re.compile(rb'["\\]'),
    ord("`"): re.compile(rb"`"),
}
_INTEGER = re.compile(rb"[+-]?[0-9]+\Z")
_NUMBER = re.compile(rb"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\Z")
_ESCAPE = re.compile(rb"\\([\s\S])|''|\"\"")
_ESCAPES = {
    b"0": b"\x00", b"b": b"\b", b"n": b"\n", b"r": b"\r", b"t": b"\t",
    b"Z": b"\x1a", b"\\": b"\\", b"'": b"'", b'"': b'"',
    b"%": b"\\%", b"_": b"\\_",
}
_DATE = re.compile(
    rb"^[ \t]*(?:(?:--|\*)[ \t]*)?Date:[ \t]*"
    rb"([0-9]{2}/[0-9]{2}/[0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2})[ \t\r\n]*$"
)
_CONSTRAINTS = {b"PRIMARY", b"KEY", b"UNIQUE", b"INDEX", b"CONSTRAINT", b"FOREIGN", b"CHECK", b"FULLTEXT", b"SPATIAL"}


class SourceError(ValueError):
    """A deliberately data-free source/validation error."""


def _identifier(value: str) -> str:
    if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
        raise SourceError("Invalid SQL identifier.")
    return value


def _selections(selections: dict[str, list[str]]) -> dict[str, tuple[str, ...]]:
    if not isinstance(selections, dict):
        raise SourceError("Selections must be a table-to-column-list dictionary.")
    result = {}
    for table, columns in selections.items():
        _identifier(table)
        if not isinstance(columns, list):
            raise SourceError("Selected columns must be a list.")
        checked = tuple(_identifier(column) for column in columns)
        if len(set(checked)) != len(checked):
            raise SourceError("Duplicate selected column.")
        result[table] = checked
    return result


class _Token(NamedTuple):
    kind: str
    raw: bytes = b""


class _SQLStream:
    """Small binary lexer; no unbounded reads or statement-sized buffering."""

    def __init__(self, source: BinaryIO):
        self.source = source
        self.buffer = b""
        self.position = 0
        self.eof = False
        if self.peek(3) == b"\xef\xbb\xbf":
            self.position += 3

    def peek(self, count: int = 1) -> bytes:
        while len(self.buffer) - self.position < count and not self.eof:
            chunk = self.source.read(_CHUNK_SIZE)
            self.buffer = self.buffer[self.position:] + chunk
            self.position = 0
            if not chunk:
                self.eof = True
        return self.buffer[self.position:self.position + count]

    def _line_comment(self) -> None:
        while self.peek():
            end = self.buffer.find(b"\n", self.position)
            if end >= 0:
                self.position = end + 1
                return
            self.position = len(self.buffer)

    def _block_comment(self) -> None:
        self.position += 2
        while self.peek(2):
            end = self.buffer.find(b"*/", self.position)
            if end >= 0:
                self.position = end + 2
                return
            if self.eof:
                break
            # Retain one byte in case the closing marker crosses a chunk.
            self.position = len(self.buffer) - 1
        raise SourceError("Truncated SQL comment.")

    def _comment(self) -> bool:
        start = self.peek(3)
        if start.startswith(b"#") or (
            start.startswith(b"--") and (len(start) == 2 or start[2] <= 32)
        ):
            self._line_comment()
            return True
        if start.startswith(b"/*"):
            self._block_comment()
            return True
        return False

    def _space_comments(self) -> None:
        while self.peek():
            match = _SPACE.match(self.buffer, self.position)
            if match:
                self.position = match.end()
            elif not self._comment():
                return

    def _quoted(self, quote: int, capture: bool) -> bytes:
        self.position += 1
        pieces = []
        size = 0

        def retain(part: bytes) -> None:
            nonlocal size
            if capture:
                size += len(part)
                if quote == ord("`") and size > 512:
                    raise SourceError("Invalid source identifier.")
                pieces.append(part)

        while self.peek():
            match = _QUOTE_SPECIAL[quote].search(self.buffer, self.position)
            if not match:
                if capture:
                    retain(self.buffer[self.position:])
                self.position = len(self.buffer)
                continue
            if capture:
                retain(self.buffer[self.position:match.start()])
            marker = self.buffer[match.start()]
            self.position = match.end()
            if marker == ord("\\"):
                escaped = self.peek()
                if not escaped:
                    raise SourceError("Truncated SQL escape.")
                retain(b"\\" + escaped)
                self.position += 1
            elif self.peek() == bytes((quote,)):
                retain(bytes((quote, quote)))
                self.position += 1
            else:
                return b"".join(pieces)
        raise SourceError("Truncated SQL quoted value.")

    def _atom(self, capture: bool) -> _Token:
        kind = "blob" if self.peek(2).lower() == b"0x" else "atom"
        # Keep only a short syntax prefix unless this is a projected scalar.
        full = capture and kind != "blob"
        pieces = []
        remaining = 128
        while self.peek(3):
            match = _ATOM_END.search(self.buffer, self.position)
            end = match.start() if match else len(self.buffer)
            if match is None and not self.eof:
                # A -- comment marker may straddle a chunk boundary.
                if self.buffer.endswith(b"--"):
                    end -= 2
                elif self.buffer.endswith(b"-"):
                    end -= 1
            length = end - self.position
            if full:
                pieces.append(self.buffer[self.position:end])
            elif remaining:
                take = min(remaining, length)
                pieces.append(self.buffer[self.position:self.position + take])
                remaining -= take
            self.position = end
            if match:
                break
        return _Token(kind, b"".join(pieces))

    def next(self, capture: bool = False) -> _Token:
        self._space_comments()
        first = self.peek()
        if not first:
            return _Token("eof")
        if first in (b"(", b")", b",", b";"):
            self.position += 1
            return _Token(first.decode("ascii"))
        if first == b"/":
            self.position += 1
            return _Token("symbol", first)
        if first == b"`":
            return _Token("identifier", self._quoted(first[0], True).replace(b"``", b"`"))
        if first in (b"'", b'"'):
            kind = "single_string" if first == b"'" else "double_string"
            return _Token(kind, self._quoted(first[0], capture))
        if self.peek(2).lower() in (b"x'", b"b'"):
            self.position += 1
            self._quoted(ord("'"), False)
            return _Token("blob")
        return self._atom(capture)

    def skip_statement(self) -> None:
        """Fast discard, retaining quote/comment state but never row contents."""
        while self.peek():
            match = _SKIP_SPECIAL.search(self.buffer, self.position)
            if not match:
                self.position = len(self.buffer)
                continue
            self.position = match.start()
            first = self.peek()
            if first == b";":
                self.position += 1
                return
            if first[0] in _QUOTE_SPECIAL:
                self._quoted(first[0], False)
            elif not self._comment():
                self.position += 1
        raise SourceError("Truncated SQL statement (missing terminator).")


def _expect(stream: _SQLStream, kind: str) -> None:
    if stream.next().kind != kind:
        raise SourceError("Malformed or truncated SQL structure.")


def _word(token: _Token, word: bytes) -> bool:
    return token.kind == "atom" and token.raw.upper() == word


def _source_name(token: _Token) -> bytes:
    if token.kind not in ("identifier", "atom") or not token.raw:
        raise SourceError("Missing or invalid source identifier.")
    return token.raw


def _create_columns(stream: _SQLStream, selected: tuple[str, ...]) -> list[bytes]:
    _expect(stream, "(")
    columns = []
    while True:
        first = stream.next()
        name = _source_name(first)
        constraint = first.kind == "atom" and name.upper() in _CONSTRAINTS
        if not constraint:
            if name in columns:
                raise SourceError("Duplicate CREATE TABLE column.")
            columns.append(name)
        depth = 0
        has_definition = False
        while True:
            token = stream.next()
            if token.kind in ("eof", ";"):
                raise SourceError("Truncated CREATE TABLE definition.")
            if token.kind == "(":
                depth += 1
            elif token.kind == ")":
                if depth == 0:
                    break
                depth -= 1
            elif token.kind == "," and depth == 0:
                break
            has_definition = True
        if not has_definition:
            raise SourceError("Incomplete CREATE TABLE column or constraint.")
        if token.kind == ")":
            break
    stream.skip_statement()
    if not columns or any(column.encode("ascii") not in columns for column in selected):
        raise SourceError("Unknown selected column in CREATE TABLE.")
    return columns


def _decode(token: _Token) -> object:
    if token.kind in ("single_string", "double_string"):
        doubled = b"''" if token.kind == "single_string" else b'""'

        def unescape(match: re.Match[bytes]) -> bytes:
            escaped = match.group(1)
            if escaped is not None:
                return _ESCAPES.get(escaped, escaped)
            pair = match.group(0)
            return pair[:1] if pair == doubled else pair

        try:
            return _ESCAPE.sub(unescape, token.raw).decode("utf-8")
        except UnicodeError:
            raise SourceError("Selected string is not valid UTF-8.") from None
    if token.kind == "blob":
        raise SourceError("Selected binary literals are not supported.")
    if token.kind == "atom":
        if token.raw.upper() == b"NULL":
            return None
        try:
            if _INTEGER.fullmatch(token.raw):
                return int(token.raw)
            if _NUMBER.fullmatch(token.raw):
                number = float(token.raw)
                if math.isfinite(number):
                    return number
        except (ValueError, OverflowError):
            pass
    raise SourceError("Unsupported or invalid selected SQL literal.")


def _insert_rows(
    stream: _SQLStream, columns: list[bytes], selected: tuple[str, ...]
) -> Iterator[dict]:
    token = stream.next()
    if token.kind == "(":
        inserted = []
        while True:
            name = _source_name(stream.next())
            if name not in columns or name in inserted:
                raise SourceError("Unknown or duplicate INSERT column.")
            inserted.append(name)
            token = stream.next()
            if token.kind == ")":
                break
            if token.kind != ",":
                raise SourceError("Malformed INSERT column list.")
        columns = inserted
        token = stream.next()
    if not _word(token, b"VALUES"):
        raise SourceError("Only INSERT VALUES is supported for selected tables.")
    positions = {column: index for index, column in enumerate(columns)}
    if any(column.encode("ascii") not in positions for column in selected):
        raise SourceError("Selected column missing from INSERT column list.")
    projection = {positions[column.encode("ascii")]: column for column in selected}
    while True:
        _expect(stream, "(")
        row = {}
        index = 0
        while True:
            token = stream.next(capture=index in projection)
            if token.kind not in ("atom", "single_string", "double_string", "blob"):
                raise SourceError("Malformed or truncated INSERT value.")
            if index >= len(columns):
                raise SourceError("INSERT column count mismatch.")
            if index in projection:
                row[projection[index]] = _decode(token)
            index += 1
            separator = stream.next()
            if separator.kind == ")":
                break
            if separator.kind != ",":
                raise SourceError("Malformed or truncated INSERT tuple.")
        if index != len(columns):
            raise SourceError("INSERT column count mismatch.")
        separator = stream.next()
        if separator.kind not in (",", ";"):
            raise SourceError("Truncated or unsupported INSERT statement.")
        yield {column: row[column] for column in selected}
        if separator.kind == ";":
            return


def dump_rows(path: Path, selections: dict[str, list[str]]) -> Iterator[tuple[str, dict]]:
    """Stream projected rows; fail closed on missing schema/columns or truncation.

    Empty selections read nothing. An empty column list yields empty dictionaries
    for row counting, but still validates the table schema and tuple lengths.
    CREATE order determines VALUES positions unless INSERT supplies column names.
    """
    wanted = _selections(selections)
    if not wanted:
        return
    names = {table.encode("ascii"): table for table in wanted}
    schemas = {}
    try:
        with Path(path).open("rb") as source:
            stream = _SQLStream(source)
            while True:
                token = stream.next()
                if token.kind == "eof":
                    break
                if token.kind == ";":
                    continue
                if _word(token, b"CREATE"):
                    token = stream.next()
                    if _word(token, b"TEMPORARY"):
                        token = stream.next()
                    if not _word(token, b"TABLE"):
                        stream.skip_statement()
                        continue
                    token = stream.next()
                    if _word(token, b"IF"):
                        if not _word(stream.next(), b"NOT") or not _word(stream.next(), b"EXISTS"):
                            raise SourceError("Malformed CREATE TABLE header.")
                        token = stream.next()
                    table = names.get(_source_name(token))
                    if table is None:
                        stream.skip_statement()
                        continue
                    if table in schemas:
                        raise SourceError("Duplicate selected CREATE TABLE.")
                    schemas[table] = _create_columns(stream, wanted[table])
                elif _word(token, b"INSERT"):
                    token = stream.next()
                    while token.kind == "atom" and token.raw.upper() in {b"LOW_PRIORITY", b"DELAYED", b"HIGH_PRIORITY", b"IGNORE"}:
                        token = stream.next()
                    if not _word(token, b"INTO"):
                        raise SourceError("Malformed INSERT header.")
                    table = names.get(_source_name(stream.next()))
                    if table is None:
                        stream.skip_statement()
                        continue
                    if table not in schemas:
                        raise SourceError("Selected INSERT has no preceding CREATE TABLE.")
                    for row in _insert_rows(stream, schemas[table], wanted[table]):
                        yield table, row
                else:
                    # Includes SET/LOCK/ALTER/DROP and executable comments: none
                    # are executed, and unrelated tables are never projected.
                    stream.skip_statement()
    except OSError:
        raise SourceError("Cannot read SQL dump.") from None
    if set(schemas) != set(wanted):
        raise SourceError("Requested table missing from SQL dump.")


def dump_metadata(path: Path) -> dict:
    """Return only basename, bytes, naive local export time, and source status."""
    path = Path(path)
    exported_at = None
    try:
        size = path.stat().st_size
        with path.open("rb") as source:
            for _ in range(20):
                # Navicat headers are short. Never load an accidental INSERT
                # line of arbitrary length when a header is absent.
                line = source.readline(8192)
                if not line or (len(line) == 8192 and not line.endswith(b"\n")):
                    break
                match = _DATE.fullmatch(line)
                if match:
                    try:
                        exported_at = datetime.strptime(
                            match.group(1).decode("ascii"), "%d/%m/%Y %H:%M:%S"
                        ).isoformat()
                    except ValueError:
                        raise SourceError("Invalid dump export date.") from None
                    break
    except OSError:
        raise SourceError("Cannot read dump metadata.") from None
    return {"filename": path.name, "sizeBytes": size, "exportedAt": exported_at, "status": "mysql_dump"}


def _mysql_options() -> tuple[bytes, dict[str, str]]:
    env = dict(os.environ)
    host = env.get("JY_DB_HOST", "127.0.0.1")
    user = env.get("JY_DB_USER", "root")
    port = env.get("JY_DB_PORT", "3306")
    if not port.isascii() or not port.isdecimal() or len(port) > 5 or not 1 <= int(port) <= 65535:
        raise SourceError("Invalid MySQL port setting.")
    for value in (host, user):
        if not value or len(value) > 255 or any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise SourceError("Invalid MySQL connection setting.")

    def option(value: str) -> str:
        return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'

    if "JY_DB_PASSWORD" in env:
        env["MYSQL_PWD"] = env["JY_DB_PASSWORD"]
    for key in ("JY_DB_HOST", "JY_DB_PORT", "JY_DB_USER", "JY_DB_PASSWORD"):
        env.pop(key, None)
    config = f"[client]\nhost={option(host)}\nport={port}\nuser={option(user)}\nprotocol=TCP\nconnect-timeout=10\n"
    return config.encode("utf-8"), env


def _mysql_start(statement: str, database: str, config: bytes, env: dict[str, str]) -> subprocess.Popen:
    # POSIX /dev/fd is available on the local macOS/Linux workflow. The options
    # pipe contains no password and is consumed solely by this child process.
    read_fd, write_fd = os.pipe()
    try:
        os.write(write_fd, config)
        os.close(write_fd)
        write_fd = -1
        return subprocess.Popen(
            ["mysql", f"--defaults-file=/dev/fd/{read_fd}", "--no-login-paths",
             "--default-character-set=utf8mb4", "-N", "-B", "-r", "--quick",
             f"--database={database}", "--execute=" + statement],
            env=env, pass_fds=(read_fd,), stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )
    finally:
        os.close(read_fd)
        if write_fd != -1:
            os.close(write_fd)


def _mysql_close(process: subprocess.Popen) -> None:
    if process.stdout is not None:
        process.stdout.close()
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def mysql_rows(database: str, selections: dict[str, list[str]]) -> Iterator[tuple[str, dict]]:
    """Explicit opt-in SELECT source; one JSON object per row, never SELECT *."""
    _identifier(database)
    wanted = _selections(selections)
    if not wanted:
        return
    config, env = _mysql_options()
    for table, columns in wanted.items():
        pairs = ", ".join(f"'{column}', `{column}`" for column in columns)
        statement = f"SELECT JSON_OBJECT({pairs}) FROM `{table}`;"
        try:
            process = _mysql_start(statement, database, config, env)
        except (OSError, ValueError):
            raise SourceError("Cannot start read-only MySQL client.") from None
        try:
            if process.stdout is None:
                raise SourceError("MySQL client output is unavailable.")
            for line in process.stdout:
                try:
                    row = json.loads(line)
                except (ValueError, UnicodeError, RecursionError):
                    raise SourceError("Invalid MySQL JSON row (details suppressed).") from None
                if not isinstance(row, dict) or set(row) != set(columns):
                    raise SourceError("Unexpected MySQL projection.")
                yield table, {column: row[column] for column in columns}
            if process.wait() != 0:
                raise SourceError("MySQL SELECT failed (details suppressed).")
        except OSError:
            raise SourceError("Cannot read MySQL client output.") from None
        finally:
            _mysql_close(process)
