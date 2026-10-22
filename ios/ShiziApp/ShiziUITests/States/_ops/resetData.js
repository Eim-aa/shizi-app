// 造数据中途清空（测试钩子 reset：删全部 v2 键、复原时钟故障），之后的 seed 是另一份数据。配合 stashBackup 用。时钟仍按夹具的 pin / setClock。
ctx.T.reset();
ctx.draft = null;
ctx.patch = null;
