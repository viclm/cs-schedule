# 客服排班系统

纯 Node + 静态网页，本地 **Excel 微型数据库** 存储每月排班，生成下个月时自动读取上月数据作为依据。

## 快速开始

```bash
cd 排班系统
npm install
npm start
```

浏览器打开 http://localhost:3456

## 数据存储

```
data/
  2026-06.xlsx    ← 6月实际排班（已导入）
  2026-07.xlsx    ← 7月生成后点击「下载」自动保存
  ...
```

- 每月一个 Excel 文件，命名格式 `YYYY-MM.xlsx`
- 生成 **2026年7月** 排班 → 自动读取 `data/2026-06.xlsx` 分析上月末班次状态
- 点击 **「下载」** → 保存到 `data/` 并下载 Excel

## 功能

| 操作 | 说明 |
|------|------|
| 生成排班 | 基于上月 Excel 数据计算换班阶段，生成新月份 |
| 下载 | 存档到 `data/` 目录 + 下载 Excel 文件 |
| 校验 | 每日人数、休息配额、连续工作等规则 |

## API（内部）

| 接口 | 说明 |
|------|------|
| `GET /api/months` | 列出已有月份 |
| `GET /api/prev/:year/:month` | 获取上月排班（生成依据） |
| `POST /api/months/:year/:month` | 保存排班 |
| `GET /api/months/:year/:month/download` | 下载 Excel |

## 环境要求

- Node.js 18+
- 无需 Python / 数据库

## 导入新月份数据

将 Excel 文件放入 `data/` 目录，命名为 `YYYY-MM.xlsx` 即可。格式需包含：

- 第1行：日期（Excel 序列号）
- 第2行：星期
- 第3行起：成员姓名 + 每日班次（夜一/夜二/休）

## 命令行测试

```bash
npm test
```
