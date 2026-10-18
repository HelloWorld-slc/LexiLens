import { uid } from "./core.mjs";
import {
  kinds,
  responses,
  relations,
  bases,
  colors,
  material,
  locate,
  isCurrent,
  optionPool,
  issues,
  validateGroups,
  requestInput,
  cacheMatch,
  validateHelp,
  saveAttempt,
  attempt,
} from "./worksheet.mjs";
import { payloadFor } from "./model";

// Only instantiated by the Windows path. All persistent data is an optional project extension.
export function createWorksheet(host: any) {
  const esc = host.escape;
  let active: any = null,
    busy: any = null,
    generation = 0,
    evidence: any = null;
  const get = () => host.project();
  const groups = () => get()?.worksheets || [];
  const article = (id: string) => get()?.articles.find((a: any) => a.id === id);
  const button = (action: string, label: string, extra = "") =>
    `<button type="button" data-ws="${action}" ${extra}>${label}</button>`;
  const opt = (values: any, value: string) =>
    Object.entries(values)
      .map(
        ([key, label]) =>
          `<option value="${key}" ${key === value ? "selected" : ""}>${esc(label)}</option>`,
      )
      .join("");
  const currentGroups = (a: any) =>
    groups().filter((g: any) => g.articleId === a.id && !g.archived);
  function clearEvidence() {
    for (let i = 0; i < colors.length; i++)
      (CSS as any).highlights?.delete(`worksheet-${i}`);
    document
      .querySelectorAll(".ws-source-markers")
      .forEach((el) => el.remove());
    evidence = null;
  }
  function cancel() {
    generation++;
    if (busy) {
      host.cancel(busy.id).catch(() => {});
      busy = null;
    }
  }
  function leave() {
    cancel();
    active = null;
    clearEvidence();
  }
  function html(a: any) {
    const gs = currentGroups(a);
    const legacy = a.paragraphs.filter((p: any) => p.kind !== "body");
    return `<section class="worksheet" data-ws-article="${a.id}" aria-label="学案"><header class="row spread wrap"><div><p class="eyebrow">PRACTICE IN CONTEXT</p><h2>学案</h2><p class="muted">${esc(a.title)} · 先作答或按需查看帮助</p></div><div class="row wrap">${button("recognize", gs.length ? "重新整理题目" : "整理题目（不解答）", `data-article="${a.id}" ${busy ? "disabled" : ""}`)}${button("add", "手动添加", `data-article="${a.id}"`)}${button("history", "学习历史", `data-article="${a.id}"`)}</div></header>${busy?.articleId === a.id ? `<div class="loading-state" role="status">正在${busy.task === "worksheet-recognize" ? "整理题目" : "准备参考帮助"}… ${button("cancel", "取消请求")}</div>` : ""}${gs.map((g: any) => `<section class="ws-group" data-group="${g.id}"><div class="row spread wrap"><h3>${esc(g.title)}</h3>${button("edit-group", "核对题组 / 归属", `data-group="${g.id}"`)}</div><p class="ws-instructions">${esc(g.instructions)}</p>${g.options.length ? `<div class="ws-bank"><strong>共享词库／选项</strong><p>重复使用：${esc({ yes: "允许", no: "不允许", unknown: "题目未明确" }[g.reuse as string])} · 词形变化：${esc({ yes: "允许", no: "不允许", unknown: "题目未明确" }[g.inflect as string])}</p>${g.options.map((o: any) => `<span class="ws-bank-word">${esc(o.label)}. ${esc(o.text)} <small data-bank="${g.id}:${o.id}">${usage(g, o.id)}</small></span>`).join("")}</div>` : ""}${!isCurrent(g, a) ? '<p class="warning">材料或题目原文已变化，此学案与结果是历史版本。请重新整理或核对题组后保存新版本。</p>' : ""}<details><summary>原始题组文字（保留）</summary><p class="ws-original">${esc(g.raw)}</p></details><div class="ws-items">${g.items.map((q: any, i: number) => itemHtml(g, q, i)).join("")}</div></section>`).join("") || '<p class="muted">尚未整理为可作答的学案。可以整理已有题目，也可以手动添加。原题不会被改写。</p>'}${legacy.length ? `<details class="ws-legacy"><summary>原有题目与说明 · ${legacy.length} 个原文块</summary>${legacy.map((p: any) => `<p class="ws-original paragraph" data-paragraph="${p.id}" data-owner="${a.id}">${esc(material(a).find((r: any) => r.paragraphId === p.id)?.text)}</p>`).join("")}${host.legacy(a)}</details>` : ""}<div class="ws-help-slot"></div></section>`;
  }
  function usage(g: any, id: string) {
    let n = 0;
    for (const q of g.items) {
      const v = attempt(get(), g, q)?.value || {};
      n += (v.selected || []).filter((x: string) => x === id).length;
      n += Object.values(v.blanks || {}).filter((x) => x === id).length;
    }
    return n
      ? `已用 ${n} 次${g.reuse === "no" && n > 1 ? " · 请核对重复" : ""}`
      : "未使用";
  }
  function itemHtml(g: any, q: any, index: number) {
    const v = attempt(get(), g, q)?.value || {},
      pool = optionPool(g, q),
      warnings = issues(g, q);
    const tr = q.translation;
    const label = `${kinds[q.kind as keyof typeof kinds]}${tr ? ` · ${{ en_zh: "英译中", zh_en: "中译英", unknown: "方向待确认" }[tr.direction as string]} · ${{ word: "词汇", phrase: "短语", sentence: "句子", unknown: "范围待确认" }[tr.unit as string]}` : ""}`;
    const choose = (blank: any = null) =>
      `<div class="ws-options">${pool.map((o: any, i: number) => `<label style="--option-color:${colors[i % colors.length]}"><input data-answer="${blank ? "blank-choice" : "choice"}" ${blank ? `data-blank="${blank.id}"` : ""} type="${q.response === "multiple" && !blank ? "checkbox" : "radio"}" name="ws-${g.id}-${q.id}-${blank?.id || ""}" value="${esc(o.id)}" ${(blank ? v.blanks?.[blank.id] === o.id : v.selected?.includes(o.id)) ? "checked" : ""}><b>${esc(o.label)}</b><span>${esc(o.text)}</span></label>`).join("")}</div>`;
    const text = (b: any) =>
      `<div class="ws-blank-row">${button("blank", `${esc(b.label)} ↗`, `data-group="${g.id}" data-item="${q.id}" data-blank="${b.id}"`)}${b.hint ? `<span>提示词：${esc(b.hint)}</span>` : "<small>无提示词</small>"}${pool.length ? `<select aria-label="空位 ${esc(b.label)}" data-answer="blank" data-blank="${b.id}"><option value="">选择…</option>${pool.map((o: any) => `<option value="${esc(o.id)}" ${v.blanks?.[b.id] === o.id ? "selected" : ""}>${esc(o.label)}. ${esc(o.text)}</option>`).join("")}</select>` : `<input aria-label="空位 ${esc(b.label)}" data-answer="blank" data-blank="${b.id}" value="${esc(v.blanks?.[b.id] || "")}" placeholder="填写此空">`}${g.inflect !== "no" && q.kind === "word_bank" ? `<label>实际词形<input data-answer="form" data-blank="${b.id}" value="${esc(v.forms?.[b.id] || "")}" placeholder="按题目要求填写"></label>` : ""}</div>`;
    return `<article class="ws-item" id="ws-item-${q.id}" data-group="${g.id}" data-item="${q.id}"><div class="row spread wrap"><p class="eyebrow">${esc(label)} · ${esc(responses[q.response as keyof typeof responses])}</p>${button("edit", "纠正题目", `data-group="${g.id}" data-item="${q.id}"`)}</div><h4>${q.number ? esc(q.number) : `题号未识别（第 ${index + 1} 项）`} · ${esc(q.stem)}</h4><p class="muted">${esc(q.requirements)}</p>${tr?.useSource === "yes" ? "<p>要求：根据本篇原文表达作答</p>" : ""}${warnings.map((w) => `<p class="warning">${esc(w)}</p>`).join("")}${q.blanks.length ? q.blanks.map((b: any) => (q.kind === "cloze" && pool.length ? `<section class="ws-cloze"><p>${button("blank", `${esc(b.label)} ↗ 原文空位`, `data-group="${g.id}" data-item="${q.id}" data-blank="${b.id}"`)}</p>${choose(b)}</section>` : text(b))).join("") : ["single", "multiple"].includes(q.response) ? `${q.response === "multiple" ? "<p><strong>可选择多个选项</strong></p>" : ""}${choose()}` : `<label>我的${q.kind === "translation" ? "译文" : "答案"}<textarea data-answer="text" rows="${q.kind === "translation" && tr?.unit !== "sentence" ? 2 : 4}" placeholder="在这里写下自己的答案">${esc(v.text || "")}</textarea></label>`}<div class="row wrap ws-item-actions"><label>完成状态 <select data-answer="status">${opt({ working: "练习中", done: "已完成", review: "待复习", uncertain: "暂不判断" }, attempt(get(), g, q)?.status || "working")}</select></label>${button("help", "提示 / 参考答案 / 讲解", `data-group="${g.id}" data-item="${q.id}"`)}${button("feedback", "参考反馈", `data-group="${g.id}" data-item="${q.id}"`)}</div><details><summary>关联原文（可能包含答案）</summary>${q.sources.map((c: any, i: number) => `<p>${button("association", esc(c.quote), `data-group="${g.id}" data-item="${q.id}" data-index="${i}"`)}</p>`).join("") || "<p>尚未确认关联位置，可在纠正题目中补充。</p>"}</details><div class="ws-inline-help"></div></article>`;
  }
  function refresh() {
    host.render();
  }
  function renderHelp(g: any, q: any, row: any, task: string) {
    const el = document
      .getElementById(`ws-item-${q.id}`)
      ?.querySelector(".ws-inline-help");
    if (!el) return;
    document
      .querySelectorAll(".ws-inline-help")
      .forEach((node) => (node.innerHTML = ""));
    active = { g, q, row, task };
    clearEvidence();
    if (task === "worksheet-feedback") {
      const d = row.data;
      el.innerHTML = `<section class="ws-help"><h4>参考反馈 · 非正式评分</h4><p>${esc({ meaning: "意义问题", grammar: "语法问题", requirement: "指定表达要求", wording: "措辞不同", acceptable: "可接受的表达", undetermined: "依据不足，暂不判断" }[d.category as string])}</p><p>${esc(d.feedback)}</p><p>${esc(d.reason)}</p><small>反馈针对请求时保存的答案；修改后请重新请求。完成状态由你决定。</small>${button("back", "回到我的作答")}</section>`;
    } else {
      const d = row.data,
        pool = optionPool(g, q);
      const citations = (cs: any[], key: string) =>
        cs
          .map((c: any, i: number) =>
            button(
              "citation",
              `↗ ${esc(c.quote)}`,
              `data-key="${key}" data-index="${i}"`,
            ),
          )
          .join("");
      el.innerHTML = `<section class="ws-help"><div class="row spread wrap"><h4>参考帮助${d.uncertain ? " · 待核对" : ""}</h4>${button("back", "回到我的作答")}</div><small>引用校验仅证明文字存在，不证明答案正确。</small><details open><summary>提示</summary><p>${esc(d.hint)}</p></details><details><summary>参考答案</summary><p class="ws-reference">${esc(d.answer)}</p>${d.parts.map((p: any) => `<p><b>${esc(q.blanks.find((b: any) => b.id === p.id)?.label)}</b>：${esc(p.answer)}</p>`).join("")}${d.translation ? `<p>${esc({ exact: "直接采用原文表达", adapted: q.translation.direction === "en_zh" ? "结合语境的参考译法" : "根据原文表达调整", none: "未找到可确认的原文表达，以下为普通参考译法", not_required: "本题不要求与原文逐字一致" }[d.translation.mode as string])}</p><blockquote>原文对应表达：${esc(d.translation.expression || "无已确认对应表达")}</blockquote><p>表达调整：${esc(d.translation.adjustments || "无")}</p>${citations(d.translation.citations, "translation")}<p>其他可接受表达：${esc(d.translation.alternatives.join("；") || "未列出，不代表其他表达错误")}</p>` : ""}</details><details><summary>完整讲解与来源</summary><p>${esc(d.explanation)}</p>${d.parts.map((p: any, i: number) => `<div><b>${esc(q.blanks.find((b: any) => b.id === p.id)?.label)} · ${esc(bases[p.basis as keyof typeof bases])}</b><p>${esc(p.text)}</p>${citations(p.citations, `part-${i}`)}</div>`).join("")}${d.points.map((p: any, i: number) => `<div><b>${esc(bases[p.basis as keyof typeof bases])}</b><p>${esc(p.text)}</p>${citations(p.citations, `point-${i}`)}</div>`).join("")}${d.options.length ? `<div class="row wrap">${button("compare", pool.length === 4 ? "四项对照" : "全部选项对照")}${button("clear", "清除证据高亮")}</div><div class="ws-comparison">${d.options.map((o: any, i: number) => `<section class="ws-option-explanation" id="ws-option-${q.id}-${o.id}" style="--option-color:${colors[i % colors.length]}">${button("option", `<b>${esc(pool.find((p: any) => p.id === o.id)?.label)}</b> · ${esc(relations[o.relation as keyof typeof relations])}`, `data-option="${o.id}"`)}${button("option", esc(o.text), `data-option="${o.id}"`)}${o.citations.length ? "<small>点击标题定位原文依据</small>" : "<small>无直接引用，不强行高亮</small>"}</section>`).join("")}</div>` : ""}</details></section>`;
    }
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function sourceMarkers(
    refs: any[],
    target: string,
    label: string,
    colorIndex = 0,
    append = false,
  ) {
    if (!append) clearEvidence();
    const ranges: Range[] = [];
    for (const ref of refs) {
      const a = article(ref.articleId);
      if (!a) continue;
      let c;
      try {
        c = locate(ref, material(a));
      } catch {
        host.toast("来源已失效，请重新核对");
        continue;
      }
      const el = document.querySelector<HTMLElement>(
        `.paragraph[data-paragraph="${c.paragraphId}"][data-owner="${c.articleId}"]`,
      );
      if (!el) {
        host.toast("该来源位于原题说明中，可展开原文或在纠正题目中核对");
        continue;
      }
      for (let parent = el.parentElement; parent; parent = parent.parentElement)
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      const r = document.createRange();
      r.setStart(el.firstChild!, c.start);
      r.setEnd(el.firstChild!, c.end);
      ranges.push(r);
      let markers = el.parentElement!.querySelector(".ws-source-markers");
      if (!markers) {
        markers = document.createElement("div");
        markers.className = "ws-source-markers row wrap";
        el.after(markers);
      }
      markers.insertAdjacentHTML(
        "beforeend",
        button(
          "return",
          `↩ ${esc(label)}`,
          `data-target="${target}" style="--option-color:${colors[colorIndex % colors.length]}"`,
        ),
      );
      if (!append) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    const api = (CSS as any).highlights;
    if (api && (window as any).Highlight) {
      const key = `worksheet-${colorIndex % colors.length}`;
      const old = append ? api.get(key) : null;
      if (old) for (const r of ranges) old.add(r);
      else api.set(key, new (window as any).Highlight(...ranges));
    }
    evidence = { target };
  }
  async function run(task: string, g: any, q: any, a: any) {
    if (busy) {
      host.toast("已有学案请求进行中，可先取消");
      return;
    }
    if (g && !isCurrent(g, a))
      throw Error("材料版本已变化，请先重新整理或核对题组");
    const p = get(),
      model = host.model();
    const input: any =
      task === "worksheet-recognize"
        ? { articleId: a.id, title: a.title, paragraphs: material(a) }
        : requestInput(g, q, a);
    if (task === "worksheet-feedback") {
      input.studentAnswer = structuredClone(attempt(p, g, q)?.value || {});
      if (
        !input.studentAnswer.text?.trim() &&
        !input.studentAnswer.selected?.length &&
        !Object.values(input.studentAnswer.blanks || {}).some(Boolean)
      )
        throw Error("请先填写自己的答案");
    }
    const cache = (p.worksheetResults || []).find((r: any) =>
      cacheMatch(r, task, input, model),
    );
    if (cache && task === "worksheet-recognize") {
      reviewRecognition(cache, a);
      return;
    }
    if (cache && task !== "worksheet-recognize") {
      renderHelp(g, q, cache, task);
      return;
    }
    if (!(await host.consent())) return;
    if (get()?.id !== p.id) return;
    const token = ++generation,
      requestId = uid();
    busy = { id: requestId, articleId: a.id, task };
    const row: any = {
      id: uid(),
      task,
      model,
      promptVersion: 1,
      input: structuredClone(input),
      created: new Date().toISOString(),
      attempts: [],
      status: "pending",
    };
    p.worksheetResults ??= [];
    p.worksheetResults.push(row);
    refresh();
    await host.commit();
    const valid = () => token === generation && get()?.id === p.id;
    try {
      let extra: any = {},
        parsed: any;
      for (let i = 0; i < 2; i++) {
        if (!valid()) return;
        const result = await host.request(
          requestId,
          payloadFor(task as any, { ...input, ...extra }, model),
        );
        row.attempts.push({
          raw: result.raw,
          usage: result.usage,
          finishReason: result.finish_reason,
        });
        if (!valid()) {
          row.status = "cancelled";
          await host.commit();
          return;
        }
        try {
          if (result.finish_reason !== "stop") throw Error("模型返回被截断");
          parsed =
            task === "worksheet-recognize"
              ? validateGroups(result.raw, a)
              : validateHelp(result.raw, input, task);
          break;
        } catch (e) {
          if (i === 1) throw e;
          extra = { previous_output: result.raw, errors: String(e) };
        }
      }
      if (!valid()) return;
      const base = { ...input };
      delete base.studentAnswer;
      if (
        JSON.stringify(material(a)) !== JSON.stringify(input.paragraphs) ||
        (g && JSON.stringify(requestInput(g, q, a)) !== JSON.stringify(base))
      )
        throw Error("材料或题目已经改变，结果保留为历史");
      row.data = parsed;
      row.status = "success";
      if (task === "worksheet-recognize") {
        row.pendingReview = true;
        busy = null;
        await host.commit();
        reviewRecognition(row, a);
      } else {
        busy = null;
        await host.commit();
        refresh();
        renderHelp(g, q, row, task);
      }
    } catch (e) {
      row.status = valid() ? "failed" : "cancelled";
      row.error = String(e);
      if (valid())
        host.toast(`未完成：${String(e)}。原始返回已保留，可从学习历史导出。`);
    } finally {
      if (token === generation) busy = null;
      if (row.status === "pending") row.status = "cancelled";
      await host.commit();
      if (valid() && row.status !== "success") refresh();
    }
  }
  function reviewRecognition(row: any, a: any) {
    host.dialog(
      "核对学案后应用",
      `<p>只整理题目，未生成答案。新版本会保留原学案、作答及讲解历史。</p>${row.data
        .map(
          (g: any) =>
            `<section><h3>${esc(g.title)}</h3><p>${esc(g.instructions)}</p>${g.items
              .map(
                (q: any) =>
                  `<p><b>${esc(kinds[q.kind as keyof typeof kinds])} · ${esc(responses[q.response as keyof typeof responses])}</b> ${esc(q.number)} ${esc(q.stem)}</p>${issues(
                    g,
                    q,
                  )
                    .map((x) => `<p class="warning">${esc(x)}</p>`)
                    .join("")}`,
              )
              .join("")}</section>`,
        )
        .join(
          "",
        )}${button("apply", "应用新学案", `data-result="${row.id}" data-article="${a.id}"`)}<p>应用后可逐题纠正题型、空位、选项和所属文章。</p>`,
    );
  }
  function refFields(ref: any, a: any, prefix: string) {
    return `<label>来源段落<select name="${prefix}-paragraph"><option value="">未关联</option>${material(
      a,
    )
      .map(
        (p: any, i: number) =>
          `<option value="${p.paragraphId}" ${ref?.paragraphId === p.paragraphId ? "selected" : ""}>${i + 1} · ${esc(p.text.slice(0, 70))}</option>`,
      )
      .join(
        "",
      )}</select></label><label>准确原文片段<input name="${prefix}-quote" value="${esc(ref?.quote || "")}"></label><label>重复片段的起点（从 0 开始；唯一片段可留空）<input type="number" min="0" name="${prefix}-start" value="${ref?.start ?? ""}"></label>`;
  }
  function readRef(f: FormData, a: any, prefix: string) {
    const id = f.get(`${prefix}-paragraph`),
      quote = String(f.get(`${prefix}-quote`) || "");
    if (!id && !quote) return null;
    const p = material(a).find((p: any) => p.paragraphId === id);
    const offset = String(f.get(`${prefix}-start`) || "");
    return locate(
      { ...p, quote, ...(offset !== "" ? { start: Number(offset) } : {}) },
      material(a),
    );
  }
  function parseOptions(value: string, old: any[]) {
    return value
      .split("\n")
      .filter((x) => x.trim())
      .map((line, i) => {
        const m = line.match(/^([^|]+)\|(.*)$/);
        if (!m) throw Error("选项请每行填写：字母 | 内容");
        return {
          id: old[i]?.id || uid(),
          label: m[1].trim(),
          text: m[2].trim(),
        };
      });
  }
  function revise(p: any, g: any, next: any) {
    // Preserve old structure and answers, never overwrite historical versions.
    const archived = structuredClone(g);
    archived.archived = true;
    p.worksheetHistory ??= [];
    p.worksheetHistory.push(archived);
    next.versionId = uid();
    next.material = material(article(next.articleId));
    const rows = (p.worksheetAnswers || []).filter(
      (r: any) => r.versionId === g.versionId,
    );
    for (const r of rows)
      p.worksheetAnswers.push({
        ...structuredClone(r),
        id: uid(),
        versionId: next.versionId,
        status: "review",
      });
    p.worksheets[p.worksheets.indexOf(g)] = next;
    clearEvidence();
    active = null;
  }
  function edit(g: any, q: any) {
    const a = article(g.articleId),
      options = q.options.map((o: any) => `${o.label} | ${o.text}`).join("\n");
    host.dialog(
      "核对与纠正题目",
      `<form id="ws-edit"><label>题号<input name="number" value="${esc(q.number)}"></label><label>题型<select name="kind">${opt(kinds, q.kind)}</select></label><label>作答方式<select name="response">${opt(responses, q.response)}</select></label><label>题干<textarea name="stem" rows="4">${esc(q.stem)}</textarea></label><label>字数 / 词形 / 指定表达要求<input name="requirements" value="${esc(q.requirements)}"></label><fieldset><legend>翻译设置（仅翻译题生效）</legend><select name="direction" aria-label="翻译方向">${opt({ unknown: "方向待确认", en_zh: "英译中", zh_en: "中译英" }, q.translation?.direction || "unknown")}</select><select name="unit" aria-label="翻译范围">${opt({ unknown: "范围待确认", word: "词汇", phrase: "短语", sentence: "句子" }, q.translation?.unit || "unknown")}</select><select name="useSource" aria-label="原文表达要求">${opt({ unknown: "原文要求未明确", yes: "要求使用原文表达", no: "不要求与原文一致" }, q.translation?.useSource || "unknown")}</select></fieldset><label>本题选项（每行：字母 | 内容；留空则使用共享词库）<textarea name="options">${esc(options)}</textarea></label><fieldset><legend>空位（每行：标记 | 提示词；无提示词留空）</legend><textarea name="blanks">${esc(q.blanks.map((b: any) => `${b.label} | ${b.hint}`).join("\n"))}</textarea>${q.blanks.map((b: any, i: number) => `<details><summary>空位 ${esc(b.label)} 的位置</summary>${refFields(b.location, a, `blank-${i}`)}</details>`).join("")}<small>新增空位后保存，再次打开可绑定位置。不会修改原文。</small></fieldset><details><summary>关联原文（可纠正意译对应）</summary>${refFields(q.sources[0], a, "source")}</details><label>缺失 / 不确定说明（每行一项）<textarea name="uncertainties">${esc(q.uncertainties.join("\n"))}</textarea></label><button class="primary">保存新题目版本</button></form>`,
    );
    document
      .getElementById("ws-edit")!
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          const f = new FormData(e.target as HTMLFormElement),
            next = structuredClone(g),
            nq = next.items.find((x: any) => x.id === q.id);
          for (const key of [
            "number",
            "kind",
            "response",
            "stem",
            "requirements",
          ])
            nq[key] = String(f.get(key) || "");
          nq.options = parseOptions(String(f.get("options")), q.options);
          nq.blanks = String(f.get("blanks"))
            .split("\n")
            .filter((x) => x.trim())
            .map((line, i) => {
              const [label, ...hint] = line.split("|");
              return {
                id: q.blanks[i]?.id || uid(),
                label: label.trim(),
                hint: hint.join("|").trim(),
                location: q.blanks[i] ? readRef(f, a, `blank-${i}`) : null,
              };
            });
          nq.translation =
            nq.kind === "translation"
              ? {
                  direction: f.get("direction"),
                  unit: f.get("unit"),
                  useSource: f.get("useSource"),
                }
              : null;
          const ref = readRef(f, a, "source");
          nq.sources = ref ? [ref, ...q.sources.slice(1)] : [];
          nq.uncertainties = String(f.get("uncertainties"))
            .split("\n")
            .filter(Boolean);
          validateGroups({ groups: [next] }, a);
          revise(get(), g, next);
          cancel();
          await host.commit();
          host.close();
          refresh();
        } catch (e) {
          host.toast(String(e));
        }
      });
  }
  function editGroup(g: any) {
    host.dialog(
      "核对题组与材料",
      `<form id="ws-group-edit"><label>所属文章<select name="article">${get()
        .articles.map(
          (a: any) =>
            `<option value="${a.id}" ${a.id === g.articleId ? "selected" : ""}>${esc(a.title)}</option>`,
        )
        .join(
          "",
        )}</select></label><label>题组标题<input name="title" value="${esc(g.title)}"></label><label>题组说明<textarea name="instructions">${esc(g.instructions)}</textarea></label><label>共享选项 / 词库（每行：字母 | 内容）<textarea name="options">${esc(g.options.map((o: any) => `${o.label} | ${o.text}`).join("\n"))}</textarea></label><label>允许重复使用<select name="reuse">${opt({ unknown: "未明确", yes: "允许", no: "不允许" }, g.reuse)}</select></label><label>允许词形变化<select name="inflect">${opt({ unknown: "未明确", yes: "允许", no: "不允许" }, g.inflect)}</select></label><p>改变所属文章将清除旧的题目来源与空位绑定，原始题组文字仍保留。保存后请逐题重新定位。</p><button class="primary">核对完成，保存新版本</button></form>`,
    );
    document
      .getElementById("ws-group-edit")!
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          const f = new FormData(e.target as HTMLFormElement),
            next = structuredClone(g);
          for (const key of ["title", "instructions", "reuse", "inflect"])
            next[key] = String(f.get(key));
          next.options = parseOptions(String(f.get("options")), g.options);
          next.articleId = String(f.get("article"));
          if (next.articleId !== g.articleId) {
            next.sources = [];
            next.manual = true;
            for (const q of next.items) {
              q.sources = [];
              q.blanks.forEach((b: any) => (b.location = null));
              q.uncertainties.push("所属材料已人工更正，请重新绑定来源");
            }
          }
          revise(get(), g, next);
          cancel();
          await host.commit();
          host.close();
          refresh();
        } catch (e) {
          host.toast(String(e));
        }
      });
  }
  async function handle(b: HTMLElement) {
    const action = b.dataset.ws!,
      g = groups().find((x: any) => x.id === b.dataset.group),
      q = g?.items.find((x: any) => x.id === b.dataset.item);
    if (action === "cancel") {
      cancel();
      refresh();
      return;
    }
    if (action === "recognize") {
      const a = article(b.dataset.article!);
      if (!material(a).some((p: any) => p.kind !== "body"))
        throw Error("没有题目或说明，请先手动添加题目");
      await run("worksheet-recognize", null, null, a);
      return;
    }
    if (action === "help" || action === "feedback") {
      await run(
        action === "help" ? "worksheet-help" : "worksheet-feedback",
        g,
        q,
        article(g.articleId),
      );
      return;
    }
    if (action === "edit") {
      edit(g, q);
      return;
    }
    if (action === "edit-group") {
      editGroup(g);
      return;
    }
    if (action === "apply") {
      const p = get(),
        row = p.worksheetResults.find((r: any) => r.id === b.dataset.result),
        a = article(b.dataset.article!);
      if (JSON.stringify(row.input.paragraphs) !== JSON.stringify(material(a)))
        throw Error("识别后原文已改变，请重新整理");
      cancel();
      p.worksheets ??= [];
      for (const old of currentGroups(a)) old.archived = true;
      // New identities prevent an AI's repeated local IDs from overwriting prior answers.
      const next = structuredClone(row.data);
      for (const g of next) {
        g.id = uid();
        for (const q of g.items) q.id = uid();
      }
      p.worksheets.push(...next);
      row.pendingReview = false;
      await host.commit();
      host.close();
      refresh();
      return;
    }
    if (action === "add") {
      const a = article(b.dataset.article!),
        p = get();
      const q = {
        id: uid(),
        number: "",
        kind: "unknown",
        response: "text",
        stem: "请填写题干",
        requirements: "",
        options: [],
        blanks: [],
        translation: null,
        sources: [],
        uncertainties: [],
      };
      const g = {
        id: uid(),
        versionId: uid(),
        articleId: a.id,
        title: "手动题组",
        instructions: "",
        raw: "用户手动创建",
        manual: true,
        sources: [],
        options: [],
        reuse: "unknown",
        inflect: "unknown",
        items: [q],
        material: material(a),
      };
      p.worksheets ??= [];
      p.worksheets.push(g);
      await host.commit();
      refresh();
      edit(g, q);
      return;
    }
    if (action === "history") {
      const p = get(),
        id = b.dataset.article,
        rows = (p.worksheetResults || []).filter(
          (r: any) =>
            r.input.articleId === id || r.input.group?.articleId === id,
        );
      host.dialog(
        "学习历史",
        `<p>历史结果不会自动作为当前答案使用。失败原稿可导出核对。</p>${[
          ...(p.worksheetHistory || []),
          ...groups().filter((g: any) => g.archived),
        ]
          .filter((g: any) => g.articleId === id)
          .map(
            (g: any) =>
              `<details><summary>${esc(g.title)} · 历史版本</summary>${g.items.map((q: any) => `<h4>${esc(q.stem)}</h4><p>我的答案：${esc(readableAttempt(attempt(p, g, q)?.value, g, q))}</p>`).join("")}</details>`,
          )
          .join(
            "",
          )}${rows.map((r: any) => `<section><p>${esc(r.created)} · ${esc(r.task === "worksheet-recognize" ? "整理题目" : r.task === "worksheet-help" ? "参考讲解" : "参考反馈")} · ${esc(r.status === "success" ? "已保存" : r.status === "failed" ? "失败" : r.status === "cancelled" ? "已取消" : "已中断")}</p>${r.data && r.task === "worksheet-recognize" && r.pendingReview ? button("review", "继续核对", `data-result="${r.id}" data-article="${id}"`) : ""}${r.data && r.task !== "worksheet-recognize" ? `<p>${esc(r.data.answer || r.data.feedback)}</p><p>${esc(r.data.explanation || r.data.reason)}</p>` : ""}${button("export", "导出该次完整记录", `data-result="${r.id}"`)}</section>`).join("") || "<p>尚无模型记录</p>"}`,
      );
      return;
    }
    if (action === "review") {
      reviewRecognition(
        get().worksheetResults.find((r: any) => r.id === b.dataset.result),
        article(b.dataset.article!),
      );
      return;
    }
    if (action === "export") {
      await host.export(
        JSON.stringify(
          get().worksheetResults.find((r: any) => r.id === b.dataset.result),
          null,
          2,
        ),
        "json",
      );
      return;
    }
    if (action === "blank") {
      const blank = q.blanks.find((x: any) => x.id === b.dataset.blank);
      if (!blank.location) {
        host.toast("此空位尚未定位，请在纠正题目中绑定");
        return;
      }
      sourceMarkers([blank.location], `ws-item-${q.id}`, `空位 ${blank.label}`);
      return;
    }
    if (action === "association") {
      sourceMarkers(
        [q.sources[Number(b.dataset.index)]],
        `ws-item-${q.id}`,
        "回到题目",
      );
      return;
    }
    if (action === "return") {
      document
        .getElementById(b.dataset.target!)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (action === "clear") {
      clearEvidence();
      return;
    }
    if (!active) return;
    if (action === "back") {
      document
        .getElementById(`ws-item-${active.q.id}`)
        ?.querySelector<HTMLElement>("[data-answer]")
        ?.focus();
      return;
    }
    if (action === "option" || action === "compare") {
      clearEvidence();
      const pool = optionPool(active.g, active.q),
        choices = active.row.data.options;
      const selected =
        action === "compare"
          ? choices
          : choices.filter((o: any) => o.id === b.dataset.option);
      for (let i = 0; i < selected.length; i++) {
        const o = selected[i],
          index = pool.findIndex((p: any) => p.id === o.id);
        sourceMarkers(
          o.citations,
          `ws-option-${active.q.id}-${o.id}`,
          `${pool[index]?.label} · ${relations[o.relation as keyof typeof relations]}`,
          index,
          i > 0,
        );
      }
      if (!selected.some((o: any) => o.citations.length))
        host.toast("此选项没有直接引用，请查看解释中的依据与不确定性");
      if (action === "compare")
        document
          .querySelector(".ws-source-markers")
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (action === "citation") {
      const [type, index] = b.dataset.key!.split("-");
      const d = active.row.data;
      const refs =
        type === "translation"
          ? d.translation.citations
          : type === "part"
            ? d.parts[Number(index)].citations
            : d.points[Number(index)].citations;
      sourceMarkers(
        [refs[Number(b.dataset.index)]],
        `ws-item-${active.q.id}`,
        "回到讲解",
      );
    }
  }
  function readableAttempt(v: any, g: any, q: any) {
    if (!v) return "尚未作答";
    const pool = optionPool(g, q);
    const display = (x: any) => pool.find((o: any) => o.id === x)?.text || x;
    return [
      v.text,
      ...(v.selected || []).map(display),
      ...Object.entries(v.blanks || {}).map(
        ([id, value]) =>
          `${q.blanks.find((b: any) => b.id === id)?.label || "空位"}: ${display(value)}`,
      ),
    ]
      .filter(Boolean)
      .join("；");
  }
  document.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-ws]");
    if (b) {
      e.preventDefault();
      handle(b).catch((e: any) => host.toast(String(e)));
    }
  });
  document.addEventListener("focusin", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".ws-item");
    if (el && evidence && active?.q.id !== el.dataset.item) clearEvidence();
  });
  document.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement,
      mode = el.dataset.answer;
    if (!mode) return;
    const node = el.closest<HTMLElement>(".ws-item")!,
      g = groups().find((g: any) => g.id === node.dataset.group),
      q = g?.items.find((q: any) => q.id === node.dataset.item);
    if (!q) return;
    const v = structuredClone(attempt(get(), g, q)?.value || {});
    if (mode === "text") v.text = el.value;
    if (mode === "form") {
      v.forms ??= {};
      v.forms[el.dataset.blank!] = el.value;
    }
    if (mode === "blank" || mode === "blank-choice") {
      v.blanks ??= {};
      v.blanks[el.dataset.blank!] = el.value;
    }
    if (mode === "choice")
      v.selected = [
        ...node.querySelectorAll<HTMLInputElement>(
          '[data-answer="choice"]:checked',
        ),
      ].map((el) => el.value);
    const row = saveAttempt(get(), g, q, v);
    if (mode === "status") row.status = el.value;
    if (active?.task === "worksheet-feedback")
      node
        .querySelectorAll(".ws-inline-help")
        .forEach((el) => (el.innerHTML = ""));
    if (
      mode === "choice" &&
      active?.q.id === q.id &&
      active.task === "worksheet-help"
    ) {
      const o = active.row.data.options.find((o: any) => o.id === el.value);
      if (o)
        sourceMarkers(
          o.citations,
          `ws-option-${q.id}-${o.id}`,
          optionPool(g, q).find((o: any) => o.id === el.value)?.label || "选项",
          optionPool(g, q).findIndex((o: any) => o.id === el.value),
        );
    }
    for (const o of g.options)
      document
        .querySelectorAll(`[data-bank="${g.id}:${o.id}"]`)
        .forEach((el) => (el.textContent = usage(g, o.id)));
    host.commit().catch((e: any) => host.toast(String(e)));
  });
  function mount() {
    clearEvidence();
    document.querySelectorAll(".ws-blank-markers").forEach((el) => el.remove());
    for (const g of groups().filter((g: any) => !g.archived)) {
      const a = article(g.articleId);
      if (!a || !isCurrent(g, a)) continue;
      for (const q of g.items)
        for (const b of q.blanks) {
          if (!b.location) continue;
          const el = document.querySelector(
            `.paragraph[data-paragraph="${b.location.paragraphId}"][data-owner="${g.articleId}"]`,
          );
          if (el) {
            const markers = document.createElement("div");
            markers.className = "ws-blank-markers";
            markers.innerHTML =
              button(
                "blank",
                `空位 ${esc(b.label)} ↔ 作答`,
                `data-group="${g.id}" data-item="${q.id}" data-blank="${b.id}"`,
              ) + button("return", "前往作答", `data-target="ws-item-${q.id}"`);
            el.after(markers);
          }
        }
    }
  }
  return { html, leave, clearEvidence, cancel, mount };
}
