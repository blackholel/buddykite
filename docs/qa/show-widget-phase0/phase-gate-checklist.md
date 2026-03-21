# Phase 0 Gate Checklist（show-widget）

使用方式：

1. 执行前复制本文件为当次评审记录。
2. 每项必须明确 `PASS/FAIL` 与证据链接。
3. 任一必选项 FAIL，则 Phase 0 不通过。

---

## A. 数据完整性

- [ ] A1 `repro-cases.json` 包含 12 条用例（6 组 * 每组 2 条）
  - 证据：
  - 结论（PASS/FAIL）：
- [ ] A2 每条用例字段齐全：`case_id/title/input/expected_observables/tags/severity`
  - 证据：
  - 结论（PASS/FAIL）：
- [ ] A3 三轮执行（Round1/2/3）共 36 次均有记录
  - 证据：
  - 结论（PASS/FAIL）：

## B. 可重复性

- [ ] B1 同一轮中同一用例可重复触发同类事件序列
  - 证据：
  - 结论（PASS/FAIL）：
- [ ] B2 36 次执行中可解析日志覆盖率 >= 98%
  - 公式：可解析事件样本数 / 应采集事件样本数
  - 证据：
  - 结论（PASS/FAIL）：
- [ ] B3 关键指标均可计算：`finalize_success_rate / widget_error_rate / first_resize_success_rate / theme_sync_success_rate / flicker_incident_count`
  - 证据：
  - 结论（PASS/FAIL）：

## C. 可追踪性

- [ ] C1 纳入基线统计事件均有非空 `runId`
  - 证据：
  - 结论（PASS/FAIL）：
- [ ] C2 关键指标可追溯到 `case_id + runId`
  - 证据：
  - 结论（PASS/FAIL）：
- [ ] C3 同一 `instanceId` 下 `seq` 单调递增
  - 证据：
  - 结论（PASS/FAIL）：

---

## 放行判定

- [ ] 放行条件全部通过（A + B + C 全 PASS）
- [ ] 进入 Phase 1

评审人：  
评审时间：  
结论：PASS / FAIL  
阻塞项（若 FAIL）：

