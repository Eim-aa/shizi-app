// 测试助手（不是测试文件：不以 .test.mjs 结尾）。D84：网页引擎退役后只剩仓库根路径。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// 需要 shizi-core-cli（swift build，链接系统 SQLite3）展开题库的用例只在 macOS 上跑；CI 的 ubuntu 跳过（D84：不加 macOS runner）。
export const NEEDS_SWIFT = process.platform === 'darwin' ? {} : { skip: 'needs shizi-core-cli (Swift on macOS); run locally (D84)' };
