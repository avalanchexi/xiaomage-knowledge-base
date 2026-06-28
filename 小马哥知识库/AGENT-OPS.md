# 本项目 Agent 操作规约(踩坑固化)

> 给在本仓库工作的任何 agent/会话。源自 2026-06-28 T7 推进复盘。先读这份再动手。

## 1. 只用 PowerShell,不用 Bash(P1)
- 本机装了 360安全卫士,会破坏 Git bash(msys2,msys-2.0.dll 3.5.7)的 fork 模拟
  → `STATUS_DLL_INIT_FAILED (0xC0000142)` + `fork: Resource temporarily unavailable`。
- 结论:Bash 工具在本环境不可用,所有 shell 操作走 PowerShell。
- 想恢复 Bash:在 360 主动防御里把 `C:\Program Files\Git` 加信任/白名单(用户侧动作,agent 改不了)。

## 2. PowerShell 5.1 + 中文文件编码(P2)
- 工具写出的文件无 BOM;PS 5.1 默认按系统码页(GBK/936)读 → 中文行尾字节吞换行、与下一行合并,
  破坏脚本结构(实测吃掉过 `param()` 和样本里的 121)。
- 规则:`.ps1` 一律 ASCII 注释;`Get-Content` 读任何文本都加 `-Encoding UTF8`;
  写中文文件用 `Set-Content -Encoding UTF8`。

## 3. worktree 路径纪律(P3,最易踩)
- 现状:Write 工具落 worktree,而 Read/Glob/Edit/PowerShell 都站主树(cwd=主树)。
  用裸路径会"写进 worktree、读看主树",造成写读分家、误拷主树。
- 铁律:T7 相关读写一律用显式 worktree 绝对路径,且优先 PowerShell:
  `D:\cursor\小马哥时政历史\.worktrees\t7-quality-gate\...`
- 别用裸 `小马哥知识库\...`(会落到主树)。主树 main 保持干净;
  T7 产物只在 worktree 分支 `codex/t7-quality-gate`。
- 可选清理:用 EnterWorktree 把所有工具搬进 worktree(更干净,未验证,试前先备份心态)。

## 4. gbrain 用法(P4)
- lint:`gbrain lint --dir wiki`(`--path <brain>` 只扫库,会报 0 pages)。
- import/lint 排除 `wiki/aliases.md`:它是 slug 词典、非知识页,会被误报 no-frontmatter / huge-page。

## 5. 其它
- `eval/codex-findings/_index.json` 要可累积(A+B 都列),勿被单次运行覆盖(P5)。
- 派 worker 时在指令里显式限定样本范围,避免范围外扩(P6,虽无害)。
- worktree 内 `wiki/log.md` 已验证为 UTF-8;旧运行日志或主树 ignored `.compile-log` 若遇 GBK,先用 `eval/fix-encoding.ps1 -Path .\.compile-log` 或显式绝对路径转 UTF-8(BOM),不要默认改主树(P7)。
