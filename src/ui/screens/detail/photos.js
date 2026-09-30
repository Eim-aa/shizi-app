// 单字详情 · 旧记录页（02 M3-6；04 R-D10；需求 R11；03 P10b；01 §3.5 photos；原型 ShiziScreen-第十稿交接版 L128–L132，
// reference/J-proto-screen.md §2.3.15）。
//
// registerScreen('detail-photo')，params {char}。入口：单字详情里有 photos[字] 时的「旧版本的记录 ›」行（actions.js）。
// 版式：全页深底 #1F1B18 / 字 #F4F0E7（原型写死，不随主题）；页头关闭 X + 标题「「{字}」的旧记录」；3:4 照片；
//   底部小标题「旧版本的记录」+ R-D10 两行说明。
// 只读：不写任何东西，没有「做成图片」（R-D10：只能看，不能做成图片）；照片不算有记录（P10b，单字详情的记录块不计它）。
// photos 域由 M5-4 迁移填充（`{[char]: {day, at, dataURL}}`）；本页只读。照片没了（恢复了别的备份）时只留标题与说明。
//
// data-testid：photo-screen（data-char）、photo-image、photo-missing、photo-caption、photo-body。

import { html, useEffect, useState } from '../../../../vendor/ui.js';
import { registerScreen } from '../../router.js';
import { Page } from '../../components/Page.js';
import { injectStyles } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { getStore } from '../../../store/store.js';

export const PHOTO_SCREEN = 'detail-photo';

injectStyles('detail-photo', `
.sz-dphoto{height:100%;background:#1F1B18;color:#F4F0E7}
.sz-dphoto .sz-page{color:#F4F0E7}
.sz-dphoto .sz-btn--icon{color:#F4F0E7}
.sz-dphoto__frame{width:100%;aspect-ratio:3/4;box-sizing:border-box;border-radius:6px;overflow:hidden;background:rgba(244,240,231,.06);
  display:grid;place-items:center}
.sz-dphoto__img{display:block;width:100%;height:100%;object-fit:contain}
.sz-dphoto__missing{font-size:15px;color:rgba(244,240,231,.6)}
.sz-dphoto__foot{display:flex;flex-direction:column;gap:6px}
.sz-dphoto__cap{font-size:13px;letter-spacing:.14em;color:rgba(244,240,231,.6)}
.sz-dphoto__body{margin:0;font-size:15px;line-height:1.7;color:rgba(244,240,231,.86)}
`);

/** photos[char]（只读）；没有返回 null。 */
export function photoOf(state, char) {
  const photos = state && state.photos && typeof state.photos === 'object' ? state.photos : null;
  if (!photos || !Object.prototype.hasOwnProperty.call(photos, char)) return null;
  const p = photos[char];
  return p && typeof p.dataURL === 'string' && p.dataURL.indexOf('data:image/') === 0 ? p : null;
}

function usePhoto(char) {
  const read = () => {
    try {
      return photoOf(getStore().getState(), char);
    } catch (error) {
      return null;
    }
  };
  const [photo, setPhoto] = useState(read);
  useEffect(() => {
    let off = () => {};
    try {
      off = getStore().subscribe(() => setPhoto(read()));
    } catch (error) {
      off = () => {};
    }
    setPhoto(read());
    return off;
  }, [char]);
  return photo;
}

function PhotoScreen({ params }) {
  const char = params && typeof params.char === 'string' ? params.char : '';
  const photo = usePhoto(char);
  const body = t('R-D10.body');
  const lines = Array.isArray(body) ? body : [body];
  return html`<div class="sz-dphoto" data-testid="photo-screen" data-char=${char}>
    <${Page} title=${t('R-D10.title', { char })} leading="close">
      <div class="sz-dphoto__frame">
        ${photo
          ? html`<img class="sz-dphoto__img" src=${photo.dataURL} alt=${t('X-DETAIL.photoAlt')} data-testid="photo-image" />`
          : html`<span class="sz-dphoto__missing" data-testid="photo-missing">${t('X-DETAIL.photoAlt')}</span>`}
      </div>
      <div class="sz-dphoto__foot">
        <span class="sz-dphoto__cap" data-testid="photo-caption">${t('X-DETAIL.legacyEntry')}</span>
        <p class="sz-dphoto__body" data-testid="photo-body">${lines.map((line, i) => (i ? html`<br />${line}` : line))}</p>
      </div>
    </${Page}>
  </div>`;
}

registerScreen(PHOTO_SCREEN, PhotoScreen, { label: t('X-DETAIL.legacyEntry') });
