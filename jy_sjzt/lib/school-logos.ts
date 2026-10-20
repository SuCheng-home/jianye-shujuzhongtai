/**
 * 学校校徽配置。
 *
 * 真实校徽图片放在 public/images/logos/，来源为学校校徽素材目录：
 * 白底/纯色底校徽已抠成透明 PNG，校园照片按圆形裁切；高清原图输出至 256×256，低清素材保留现有版本。
 * 图片名与学校一一对应；没有匹配图片的学校由 components/dashboard/school-emblem.ts 生成默认徽章。
 * 没有真实校徽的学校仍由 components/dashboard/school-emblem.ts 生成默认徽章。
 */
export const SCHOOL_LOGOS: Record<string, string> = {
  // 小学
  '南京市北京东路小学': '/images/logos/bjdlxx.png',
  '南京市长江路小学': '/images/logos/cjlxx.png',
  '南京市成贤街小学': '/images/logos/cxjxx.png',
  '南京市小营小学': '/images/logos/xyxx.png',
  '南京市海英小学': '/images/logos/hyxx.png',
  '南京师范大学附属小学': '/images/logos/nsfx.png',
  '南京理工大学实验小学': '/images/logos/nlg-syxx.png',
  '南京市樱花小学': '/images/logos/yhxx.png',
  '南京市月苑第一小学': '/images/logos/yy-dyxx.png',
  '南京市北京东路小学红山分校': '/images/logos/bjdl-hs.png',
  '南京玄武外国语学校附属小学': '/images/logos/xwwgy-fx.png',
  '南京市启迪小学': '/images/logos/qdxx.png', // 南京市长江路小学启迪分校
  '南京市锁金新村第一小学': '/images/logos/sjxc-yx.png',
  '南京市锁金新村第二小学': '/images/logos/sjxc-ex.png',
  '南京市北京东路小学紫金山分校': '/images/logos/bjdl-zj.png', // 素材为「紫金分校」
  '南京市立贤小学': '/images/logos/lxxx.png',
  '南京市逸仙小学': '/images/logos/yxxx.png',
  '南京市洪武北路小学': '/images/logos/hwblxx.png',
  '南京市同仁小学': '/images/logos/trxx.png',
  '南京市中央路小学': '/images/logos/zylxx.png',
  '南京农业大学实验小学': '/images/logos/njau-syxx.png',
  '南京市科利华小学': '/images/logos/klhxx.png',
  '南京市铁北新城小学': '/images/logos/tbxcxx.png', // 素材为「南师附小铁北新城分校」
  '南京市徐庄高新区实验小学': '/images/logos/xz-xhm.png', // 素材为「南师附小仙鹤门分校」照片（徐庄实小即仙鹤门校区）

  // 初中
  '南京市第九初级中学': '/images/logos/dj-cz.png',
  '南京市第五十四中学': '/images/logos/d54zx.png',
  '南京市科利华铁北中学': '/images/logos/klh-tb.png', // 素材为「科利华中学铁北分校」
  '南京市孝陵卫初级中学': '/images/logos/xlwcz.png',
  '南京玄武外国语学校': '/images/logos/xwwgy.png',
  '南京市第十三中学锁金分校': '/images/logos/sssz-sj.png',
  '南京市科利华中学': '/images/logos/klhzx.png',
  '南京市科利华紫金中学': '/images/logos/klh-zj.png', // 素材为「科利华中学紫金分校」
  '南京市科利华铁北第二中学': '/images/logos/klh-tb2.png', // 素材为「科利华中学铁北第二分校」
  '南京市弘光中学': '/images/logos/hgzx.png', // 素材为「南京理工大学附属中学」
  '南京市紫东实验学校': '/images/logos/zdsyxx.png',

  // 高中
  '南京市第十三中学': '/images/logos/sssz.png',
  '南京市第九中学': '/images/logos/djzx.png',
  '南京市玄武高级中学': '/images/logos/xwgjzx.png',
  '南京市人民中学': '/images/logos/rmzx.png', // 照片

  // 职业学校与特殊教育
  '南京市玄武中等专业学校': '/images/logos/xwzz.png',
  '南京市玄武区特殊教育学校': '/images/logos/xw-tj.png',
}

/** 默认徽章中心显示的简称；未配置时自动取校名前两个字。 */
export const SCHOOL_SHORT_NAMES: Record<string, string> = {
  '南京市第十三中学': '十三中',
  '南京市第十三中学锁金分校': '十三中',
  '南京市第九中学': '九中',
  '南京市第九初级中学': '九中',
  '南京市第五十四中学': '五四',
  '南京市玄武高级中学': '玄高',
  '南京市人民中学': '人中',
  '南京玄武外国语学校': '玄外',
  '南京玄武外国语学校附属小学': '玄外',
  '南京市北京东路小学': '北东',
  '南京市北京东路小学红山分校': '北东',
  '南京市北京东路小学紫金山分校': '北东',
  '南京市玄武实验小学': '实小',
  '南京师范大学附属小学': '南师',
  '南京理工大学实验小学': '理工',
  '南京农业大学实验小学': '南农',
  '南京市锁金新村第一小学': '锁一',
  '南京市锁金新村第二小学': '锁二',
  '南京市月苑第一小学': '月苑',
  '南京市科利华中学': '科利华',
  '南京市科利华小学': '科利华',
  '南京市科利华紫金中学': '科利华',
  '南京市科利华铁北中学': '铁北',
  '南京市科利华铁北第二中学': '铁北',
  '南京市玄武中等专业学校': '玄职',
  '南京市玄武区特殊教育学校': '特教',
  '南京市徐庄高新区实验小学': '徐庄',
}
