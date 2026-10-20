#!/usr/bin/env python3
"""Offline unittest coverage; fixtures are synthetic and never contain real PII.

Run with: python3 -B scripts/test-jianye-sources.py -v
(The requested hyphenated filename is not found by unittest discovery.)
No dump imports, database connections, network calls, or persistent test output.
"""

from __future__ import annotations

import io
import json
import os
import tempfile
import traceback
import tracemalloc
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import jianye_sources as sources


SCHEMA = b"""CREATE TABLE `sample` (
  `id` int NOT NULL,
  `label` text,
  `unselected` longblob,
  `amount` decimal(12, 4),
  `optional` varchar(80) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `label_key` (`label`(12))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""


class DumpTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "synthetic.sql"
        mysql_patch = patch.object(sources.subprocess, "Popen")
        self.mysql = mysql_patch.start()
        self.addCleanup(mysql_patch.stop)
        self.mysql.side_effect = AssertionError("Dump reading must not start MySQL")

    def sql(self, data: bytes | str) -> Path:
        self.path.write_bytes(data.encode("utf-8") if isinstance(data, str) else data)
        return self.path

    def rows(self, data: bytes | str, selected=None):
        return list(sources.dump_rows(self.sql(data), {"sample": ["id"]} if selected is None else selected))

    def assert_rejected(self, data: bytes | str, selected=None):
        with self.assertRaises(sources.SourceError) as error:
            self.rows(data, selected)
        self.assertNotIn("PRIVATE_SENTINEL", str(error.exception))
        self.mysql.assert_not_called()

    def test_chinese_escapes_projection_and_null(self):
        literal = r'''中文, (括号); it''s \' \" \\ \n \r \t \b \0 \Z \q \% \_ ""'''
        expected = '中文, (括号); it\'s \' " \\ \n \r \t \b \x00 \x1a q \\% \\_ ""'
        sql = SCHEMA + ("INSERT INTO `sample` VALUES (7,'" + literal + "',0x00FF,-12.5e2,NULL);").encode("utf-8")
        selected = ["label", "id", "optional", "amount"]
        self.assertEqual(self.rows(sql, {"sample": selected}), [
            ("sample", {"label": expected, "id": 7, "optional": None, "amount": -1250.0})
        ])
        self.mysql.assert_not_called()

    def test_multiple_tuples_multiline_and_statements(self):
        sql = SCHEMA + b"""INSERT INTO `sample` VALUES
          (1,'a,();',0x12,1,NULL),
          (2,'b',0x34,.25,'NULL');
          INSERT INTO `sample` VALUES (3,'c',NULL,+2.0e-1,NULL);
        """
        self.assertEqual(self.rows(sql, {"sample": ["id", "amount", "optional"]}), [
            ("sample", {"id": 1, "amount": 1, "optional": None}),
            ("sample", {"id": 2, "amount": 0.25, "optional": "NULL"}),
            ("sample", {"id": 3, "amount": 0.2, "optional": None}),
        ])

    def test_explicit_columns_reorder_and_omit_unselected(self):
        sql = SCHEMA + b"INSERT INTO `sample` (`label`, `id`) VALUES ('first',10),('second',11);"
        rows = self.rows(sql, {"sample": ["id", "label"]})
        self.assertEqual(rows, [("sample", {"id": 10, "label": "first"}), ("sample", {"id": 11, "label": "second"})])
        self.assertEqual(list(rows[0][1]), ["id", "label"])

    def test_ignores_tables_comments_and_never_executes_statements(self):
        sql = b"""\xef\xbb\xbf/* header ; ' */
        SET FOREIGN_KEY_CHECKS = 0;
        DROP TABLE IF EXISTS `sample`;
        CREATE TABLE `ignored` (`anything` text);
        INSERT INTO `ignored` VALUES ('\xff,;()', 0x123456);
        /*!50000 INSERT INTO `sample` VALUES ('must not be executed'); */
        -- ignored comment ; '
        # another comment
        """ + SCHEMA + b"INSERT INTO `sample` VALUES (4,'ok','\xff',1,NULL);"
        self.assertEqual(self.rows(sql), [("sample", {"id": 4})])
        self.mysql.assert_not_called()

    def test_only_selected_values_are_decoded(self):
        sql = SCHEMA + b"INSERT INTO `sample` VALUES (1,'\xff','PRIVATE_SENTINEL',0x1234,NULL);"
        with patch.object(sources, "_decode", wraps=sources._decode) as decode:
            self.assertEqual(self.rows(sql), [("sample", {"id": 1})])
        self.assertEqual(decode.call_count, 1)
        self.assertEqual(decode.call_args.args[0].raw, b"1")

    def test_selected_invalid_utf8_is_redacted(self):
        data = SCHEMA + b"INSERT INTO `sample` VALUES (1,'PRIVATE_SENTINEL\xff',NULL,0,NULL);"
        try:
            self.rows(data, {"sample": ["label"]})
        except sources.SourceError as error:
            rendered = "".join(traceback.format_exception(type(error), error, error.__traceback__))
            self.assertNotIn("PRIVATE_SENTINEL", rendered)
            self.assertNotIn("UnicodeDecodeError", rendered)
        else:
            self.fail("Invalid selected UTF-8 must be rejected")

    def test_blob_literals_skipped_but_selected_rejected(self):
        for blob in (b"0x00FF", b"0XABCD", b"X'00FF'", b"b'0101'"):
            with self.subTest(blob_type=blob[:2]):
                sql = SCHEMA + b"INSERT INTO `sample` VALUES (1,'ok'," + blob + b",0,NULL);"
                self.assertEqual(self.rows(sql), [("sample", {"id": 1})])
                self.assert_rejected(sql, {"sample": ["unselected"]})

    def test_double_quoted_strings_and_doubled_quotes(self):
        sql = SCHEMA + b'''INSERT INTO `sample` VALUES (1,"a""b''c\\\"d",NULL,0,NULL);'''
        self.assertEqual(self.rows(sql, {"sample": ["label"]}), [("sample", {"label": 'a"b\'\'c"d'})])

    def test_bare_identifiers_and_nested_create_defaults(self):
        sql = """CREATE TABLE IF NOT EXISTS sample (
            id int, label enum('x,y', 'a);b') DEFAULT 'x,y',
            unselected varchar(20) COMMENT '();,',
            amount decimal(12,4), optional text,
            CONSTRAINT ck CHECK ((id > 0) AND (amount > -1))
        );
        INSERT INTO sample (id, label) VALUES (+3, 'x,y');"""
        self.assertEqual(self.rows(sql, {"sample": ["label", "id"]}), [("sample", {"label": "x,y", "id": 3})])

    def test_chunk_boundaries_preserve_strings_comments_and_utf8(self):
        sql = (b"/* block */ -- comment\nCREATE TABLE `ignored` (`x` text);"
               b"INSERT INTO `ignored` VALUES ('a\\\';b', '\xff');" + SCHEMA
               + "INSERT INTO `sample` VALUES (-12,'中文;() it''s \\\\ end',0xABCD,0,NULL),(13,'z',NULL,0,NULL);".encode("utf-8")
               + b"/* trailing */")
        for chunk_size in range(1, 24):
            with self.subTest(chunk_size=chunk_size), patch.object(sources, "_CHUNK_SIZE", chunk_size):
                self.assertEqual(self.rows(sql, {"sample": ["id", "label"]}), [
                    ("sample", {"id": -12, "label": "中文;() it's \\ end"}),
                    ("sample", {"id": 13, "label": "z"}),
                ])

    def test_comments_adjacent_to_values_across_chunks(self):
        sql = SCHEMA + b"INSERT INTO `sample` VALUES (-12/*comment*/, 'ok'/**/, NULL-- comment\n,0# note\n,NULL);"
        for size in range(1, 24):
            with self.subTest(chunk_size=size), patch.object(sources, "_CHUNK_SIZE", size):
                self.assertEqual(self.rows(sql, {"sample": ["id", "amount", "optional"]}), [
                    ("sample", {"id": -12, "amount": 0, "optional": None})
                ])

    def test_streaming_large_unselected_fields_and_ignored_statements(self):
        payload = b"s" * (4 * 1024 * 1024)
        raw = (SCHEMA + b"INSERT INTO `sample` VALUES (1,'ok','" + payload
               + b"',0,NULL); INSERT INTO `ignored` VALUES ('" + payload
               + b"'); INSERT INTO `sample` VALUES (2,'ok',0x" + b"AA" * (2 * 1024 * 1024)
               + b",0,NULL);")
        chunk_size = sources._CHUNK_SIZE

        class GuardedReader(io.BytesIO):
            def read(self, size=-1):
                if size <= 0 or size > chunk_size:
                    raise AssertionError("Unbounded read requested")
                return super().read(size)

            def readline(self, size=-1):
                raise AssertionError("Dump rows must not buffer physical lines")

        reader = GuardedReader(raw)
        with patch.object(Path, "open", return_value=reader):
            tracemalloc.start()
            try:
                self.assertEqual(list(sources.dump_rows(self.path, {"sample": ["id"]})), [
                    ("sample", {"id": 1}), ("sample", {"id": 2})
                ])
                _, peak = tracemalloc.get_traced_memory()
            finally:
                tracemalloc.stop()
        self.assertLess(peak, 2 * 1024 * 1024)
        self.assertTrue(reader.closed)

    def test_iterator_is_lazy_and_closes_file(self):
        raw = SCHEMA + b"INSERT INTO `sample` VALUES (1,'ok',NULL,0,NULL);" + b" " * (3 * sources._CHUNK_SIZE)
        reader = io.BytesIO(raw)
        with patch.object(Path, "open", return_value=reader) as opened:
            iterator = sources.dump_rows(self.path, {"sample": ["id"]})
            opened.assert_not_called()
            self.assertEqual(next(iterator), ("sample", {"id": 1}))
            self.assertLess(reader.tell(), len(raw))
            iterator.close()
        self.assertTrue(reader.closed)

    def test_truncated_inserts_and_comments_rejected_without_values(self):
        inserts = [
            b"INSERT INTO `sample` VALUES (1,'PRIVATE_SENTINEL',NULL,0,NULL)",
            b"INSERT INTO `sample` VALUES (1,'PRIVATE_SENTINEL",
            b"INSERT INTO `sample` VALUES (1,'PRIVATE_SENTINEL\\",
            b"INSERT INTO `sample` VALUES (1,'PRIVATE_SENTINEL',NULL,0,NULL),",
            b"INSERT INTO `sample` VALUES (1,'PRIVATE_SENTINEL',NULL,0,NULL),(2,'x'",
            b"INSERT INTO `sample` VALUES (1,'PRIVATE_SENTINEL',NULL,0,NULL); /* unfinished",
            b"INSERT INTO `ignored` VALUES ('PRIVATE_SENTINEL",
        ]
        for index, insert in enumerate(inserts):
            with self.subTest(case=index):
                self.assert_rejected(SCHEMA + insert)

    def test_truncated_create_and_no_schema_rejected(self):
        for sql in (
            b"CREATE TABLE `sample` (`id` int",
            b"CREATE TABLE `sample` (`id` int)",
            b"CREATE TABLE `sample` (`id` int,",
            b"INSERT INTO `sample` VALUES (1);",
        ):
            self.assert_rejected(sql)

    def test_tuple_counts_rejected_even_when_only_one_column_selected(self):
        for values in (b"(1,'PRIVATE_SENTINEL')", b"(1,'PRIVATE_SENTINEL',NULL,0,NULL,99)", b"()", b"(1,,NULL,0,NULL)"):
            self.assert_rejected(SCHEMA + b"INSERT INTO `sample` VALUES " + values + b";")

    def test_unknown_duplicate_and_missing_insert_columns_rejected(self):
        for columns, values in (
            (b"`id`, `unknown`", b"1,2"),
            (b"`id`, `id`", b"1,2"),
            (b"`label`", b"'PRIVATE_SENTINEL'"),
        ):
            self.assert_rejected(SCHEMA + b"INSERT INTO `sample` (" + columns + b") VALUES (" + values + b");")
        self.assert_rejected(SCHEMA, {"sample": ["unknown"]})
        self.assert_rejected(b"CREATE TABLE `sample` (`id` int, `id` text);")
        self.assert_rejected(SCHEMA + SCHEMA)

    def test_missing_tables_and_empty_tables(self):
        self.assertEqual(self.rows(SCHEMA), [])
        self.assert_rejected(SCHEMA, {"absent": ["id"]})
        self.assert_rejected(SCHEMA, {"sample": ["id"], "absent": []})
        self.assert_rejected(b"")

    def test_empty_projection_counts_rows_and_empty_selection_reads_nothing(self):
        sql = SCHEMA + b"INSERT INTO `sample` VALUES (1,'a',NULL,0,NULL),(2,'b',NULL,0,NULL);"
        with patch.object(sources, "_decode", side_effect=AssertionError("No selected values")):
            self.assertEqual(self.rows(sql, {"sample": []}), [("sample", {}), ("sample", {})])
        with patch.object(Path, "open", side_effect=AssertionError("No selected tables")):
            self.assertEqual(list(sources.dump_rows(self.path, {})), [])

    def test_multiple_selected_tables_keep_input_order(self):
        sql = b"""CREATE TABLE a (`n` int); CREATE TABLE b (`v` text);
            INSERT INTO b VALUES ('test'); INSERT INTO a VALUES (42);"""
        self.assertEqual(self.rows(sql, {"a": ["n"], "b": ["v"]}), [("b", {"v": "test"}), ("a", {"n": 42})])

    def test_unsupported_projected_literals_and_nonfinite_numbers_rejected(self):
        for literal in (b"DEFAULT", b"PRIVATE_SENTINEL", b"1e9999", b"NaN", b"NOW()"):
            self.assert_rejected(SCHEMA + b"INSERT INTO `sample` VALUES (" + literal + b",'ok',NULL,0,NULL);")

    def test_identifier_validation_before_open(self):
        invalid = [
            {"sample;DROP": ["id"]}, {"sample": ["id`"]}, {"sample": ["a.b"]},
            {"sample": ["id", "id"]}, {"sample": "id"}, {"sample": [None]},
            {"": ["id"]}, {"a" * 65: []}, {"sample": ["x\n"]},
        ]
        with patch.object(Path, "open", side_effect=AssertionError("Invalid identifier must not reach I/O")):
            for selection in invalid:
                with self.subTest(case=invalid.index(selection)), self.assertRaises(sources.SourceError):
                    list(sources.dump_rows(self.path, selection))


class MetadataTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "synthetic.sql"

    def test_export_date_is_naive_local_iso_and_host_is_absent(self):
        content = b"/*\n Source Server: internal-host.invalid\n Source Host: internal-host.invalid:3306\n Date: 15/10/2026 15:37:29\n*/\n"
        self.path.write_bytes(content)
        result = sources.dump_metadata(self.path)
        self.assertEqual(result, {"filename": "synthetic.sql", "sizeBytes": len(content), "exportedAt": "2026-10-15T15:37:29", "status": "mysql_dump"})
        self.assertIsNone(datetime.fromisoformat(result["exportedAt"]).tzinfo)
        self.assertNotIn("internal-host", json.dumps(result))

    def test_only_first_twenty_lines_are_examined(self):
        date = b"-- Date: 15/10/2026 15:37:29\r\n"
        self.path.write_bytes(b"-- header\n" * 19 + date)
        self.assertEqual(sources.dump_metadata(self.path)["exportedAt"], "2026-10-15T15:37:29")
        self.path.write_bytes(b"-- header\n" * 20 + date)
        self.assertIsNone(sources.dump_metadata(self.path)["exportedAt"])

    def test_missing_date_empty_file_and_long_line(self):
        for content in (b"", b"-- no date\n", b"x" * 100000 + b"\nDate: 15/10/2026 15:37:29\n"):
            self.path.write_bytes(content)
            self.assertIsNone(sources.dump_metadata(self.path)["exportedAt"])

    def test_invalid_date_and_missing_file_are_sanitized(self):
        self.path.write_bytes(b"Date: 31/02/2026 15:37:29\n")
        with self.assertRaises(sources.SourceError):
            sources.dump_metadata(self.path)
        self.path.unlink()
        with self.assertRaises(sources.SourceError):
            sources.dump_metadata(self.path)
        with self.assertRaises(sources.SourceError):
            list(sources.dump_rows(self.path, {"sample": ["id"]}))


class FakeProcess:
    def __init__(self, output=b"", exit_code=0):
        self.stdout = io.BytesIO(output)
        self.exit_code = exit_code
        self.returncode = None
        self.terminated = False
        self.killed = False

    def wait(self, timeout=None):
        self.returncode = self.exit_code
        return self.returncode

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated = True
        self.returncode = -15

    def kill(self):
        self.killed = True
        self.returncode = -9


class MySQLTests(unittest.TestCase):
    def setUp(self):
        client_patch = patch.object(sources.subprocess, "Popen")
        self.client = client_patch.start()
        self.addCleanup(client_patch.stop)
        environment_patch = patch.dict(os.environ, {}, clear=True)
        environment_patch.start()
        self.addCleanup(environment_patch.stop)
        self.processes = []
        self.commands = []
        self.configs = []
        self.environments = []
        self.outputs = []

        def start(command, **kwargs):
            self.commands.append(command)
            self.configs.append(os.read(kwargs["pass_fds"][0], 4096))
            self.environments.append(kwargs["env"])
            self.assertIs(kwargs["stderr"], sources.subprocess.DEVNULL)
            self.assertIs(kwargs["stdin"], sources.subprocess.DEVNULL)
            output, code = self.outputs.pop(0) if self.outputs else (b"", 0)
            process = FakeProcess(output, code)
            self.processes.append(process)
            return process

        self.client.side_effect = start

    def test_explicit_select_json_streaming_flags_and_private_credentials(self):
        os.environ.update(JY_DB_HOST="synthetic-host.invalid", JY_DB_PORT="3307", JY_DB_USER="synthetic_user", JY_DB_PASSWORD="synthetic_password")
        self.outputs = [(json.dumps({"Code": "demo", "Name": "合成组织\n二行"}, ensure_ascii=False).encode("utf-8") + b"\n", 0)]
        iterator = sources.mysql_rows("sample_db", {"organizations": ["Code", "Name"]})
        self.client.assert_not_called()
        self.assertEqual(list(iterator), [("organizations", {"Code": "demo", "Name": "合成组织\n二行"})])
        command = self.commands[0]
        for flag in ("--default-character-set=utf8mb4", "-N", "-B", "-r", "--quick"):
            self.assertIn(flag, command)
        self.assertEqual(command[-1], "--execute=SELECT JSON_OBJECT('Code', `Code`, 'Name', `Name`) FROM `organizations`;")
        for setting in ("synthetic-host.invalid", "3307", "synthetic_user", "synthetic_password"):
            self.assertNotIn(setting, " ".join(command))
        self.assertNotIn(b"synthetic_password", self.configs[0])
        self.assertIn(b'host="synthetic-host.invalid"', self.configs[0])
        self.assertEqual(self.environments[0]["MYSQL_PWD"], "synthetic_password")
        self.assertNotIn("JY_DB_PASSWORD", self.environments[0])
        self.assertTrue(self.processes[0].stdout.closed)

    def test_mysql_pwd_fallback_and_explicit_empty_password(self):
        os.environ["MYSQL_PWD"] = "fallback_password"
        list(sources.mysql_rows("db", {"sample": []}))
        self.assertEqual(self.environments[-1]["MYSQL_PWD"], "fallback_password")
        os.environ["JY_DB_PASSWORD"] = ""
        list(sources.mysql_rows("db", {"sample": []}))
        self.assertEqual(self.environments[-1]["MYSQL_PWD"], "")

    def test_multiple_tables_and_empty_projection(self):
        self.outputs = [(b'{"id":1}\n{"id":2}\n', 0), (b'{}\n', 0)]
        self.assertEqual(list(sources.mysql_rows("db", {"sample": ["id"], "other": []})), [
            ("sample", {"id": 1}), ("sample", {"id": 2}), ("other", {}),
        ])
        self.assertIn("--execute=SELECT JSON_OBJECT() FROM `other`;", self.commands[1])
        self.assertEqual(self.client.call_count, 2)

    def test_invalid_identifiers_and_environment_rejected_before_launch(self):
        for database, selection in (("db;DROP", {"sample": []}), ("db", {"bad`": ["id"]}), ("db", {"sample": ["id' OR 1"]})):
            with self.assertRaises(sources.SourceError):
                list(sources.mysql_rows(database, selection))
        for port in ("0", "65536", "3306\n", "--help", "9" * 100):
            os.environ["JY_DB_PORT"] = port
            with self.assertRaises(sources.SourceError):
                list(sources.mysql_rows("db", {"sample": []}))
        os.environ["JY_DB_PORT"] = "3306"
        os.environ["JY_DB_USER"] = "unsafe\ninit-command=SELECT 1"
        with self.assertRaises(sources.SourceError):
            list(sources.mysql_rows("db", {"sample": []}))
        self.client.assert_not_called()

    def test_no_selection_means_no_connection(self):
        self.assertEqual(list(sources.mysql_rows("db", {})), [])
        self.client.assert_not_called()

    def test_mysql_failures_and_unexpected_rows_are_redacted(self):
        for output, exit_code in (
            (b"", 1), (b"PRIVATE_SENTINEL not json\n", 0),
            (b'{"unexpected":"PRIVATE_SENTINEL"}\n', 0), (b"[]\n", 0),
            (b'{"id":"\xffPRIVATE_SENTINEL"}\n', 0),
        ):
            self.outputs = [(output, exit_code)]
            with self.assertRaises(sources.SourceError) as error:
                list(sources.mysql_rows("db", {"sample": ["id"]}))
            self.assertNotIn("PRIVATE_SENTINEL", str(error.exception))
            self.assertTrue(self.processes[-1].stdout.closed)
        self.client.side_effect = FileNotFoundError("PRIVATE_SENTINEL")
        with self.assertRaises(sources.SourceError) as error:
            list(sources.mysql_rows("db", {"sample": []}))
        self.assertNotIn("PRIVATE_SENTINEL", str(error.exception))

    def test_early_close_terminates_process(self):
        self.outputs = [(b'{"id":1}\n{"id":2}\n', 0)]
        iterator = sources.mysql_rows("db", {"sample": ["id"]})
        self.assertEqual(next(iterator), ("sample", {"id": 1}))
        iterator.close()
        self.assertTrue(self.processes[0].terminated)
        self.assertTrue(self.processes[0].stdout.closed)


if __name__ == "__main__":
    unittest.main()
