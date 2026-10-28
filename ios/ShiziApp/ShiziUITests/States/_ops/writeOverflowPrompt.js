// Flow-only overflow stress: reuse the longest existing hint four times. No
// production copy/layout constants change. Both web and native read this card.
const deck = await import('/src/data/deck.js');
const card = deck.cardForKey('base:姥');
const { visibleHint } = await import('/src/core/cards.js');
const hint = visibleHint(card);
if (!hint) return { ok: false, error: 'missing existing hint' };
deck.setCardResolver(key => key === 'base:姥' ? { ...card, hint: hint.repeat(4), promptHint: hint.repeat(4) } : undefined);
(window.__qaCleanups ||= []).push(() => deck.setCardResolver(null));
