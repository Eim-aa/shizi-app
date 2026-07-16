// 由 scripts/build_8105_chars.py 同步生成：首日校准字优先，再按题库字频补满 600 字。
(function(scope){
  const calibration=["尴","嚏","狩","晤","飓","痿","俾","跻","徵","瞰","裘","娩","邃","暧","煲"];
  scope.SHIZI_CORE_STROKES=[...new Set([...calibration,...SEED.slice().sort((a,b)=>a.rank-b.rank).map(card=>card.target)])].slice(0,600);
})(self);
