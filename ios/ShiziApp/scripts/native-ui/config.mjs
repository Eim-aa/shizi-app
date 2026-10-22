// QA-H1 原生界面检查的固定条件（参考图与对比都按这里）。改这里要重新生成参考图：
//   ios/ShiziApp/scripts/verify-native-ui.sh --update-reference
// B3.3 起状态不再写在这里：状态 = ShiziUITests/States/<状态>.json 夹具（registry.mjs 按目录扫描），STATES / AX_STATES / STATE_NAMES 都由夹具推出。
import { AX_STATES, REFERENCE_STATES, STATES, STATE_NAMES, fixtureOf, sizesOf, statesForSize } from './registry.mjs';

export const BUNDLE_ID = 'com.eimaa.shizi';
/** 固定模拟器：iPhone 17 / iOS 26.5（脚本每次新建、用完删除，名字带 QA-H1 前缀）。 */
export const DEVICE_TYPE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-17';
export const RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-26-5';
/** 逐屏对比覆盖的状态（夹具 native: true；与 App 内 QAFixture.parityNames(native: true) 同一份）。 */
export { STATES, STATE_NAMES, AX_STATES, REFERENCE_STATES, fixtureOf, sizesOf, statesForSize };
export const APPEARANCES = ['light', 'dark'];
export const SIZES = ['L', 'XXXL'];
/** B2.9b：大字号（AX1–AX5 版式）的主要状态 × AX3 / AX5（参考图同样取网页版；AX-01「不溢出」只在这两档跑）。哪些状态取 AX 档由夹具的 ax / sizes 决定。 */
export const AX_SIZES = ['AX3', 'AX5'];
export const ALL_SIZES = [...SIZES, ...AX_SIZES];
export const SIZE_SIM = { xS: 'extra-small', L: 'large', XL: 'extra-large', XXXL: 'extra-extra-extra-large', AX3: 'accessibility-extra-large', AX5: 'accessibility-extra-extra-extra-large' };
