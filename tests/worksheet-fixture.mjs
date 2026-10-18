import { newLibrary, newProject, paragraph, uid } from "../src/core.mjs";
import { material, validateGroups } from "../src/worksheet.mjs";
export function fixture() {
  const lib = newLibrary(),
    p = newProject("合成学案实验 A");
  const a = {
    id: uid(),
    title: "社区阅读俱乐部",
    paragraphs: [
      paragraph(
        "Maya takes part in a reading club every Friday. The club welcomes everyone. They read stories and share ideas.",
      ),
      paragraph(
        "Last year, the club planted a garden. This year, members will help children read. They hope that small steps can make a difference.",
      ),
      paragraph(
        "Maya ___(1)___ ___(2)___ in the club. She has ___(3)___ (learn) a lot. ___(4)___ club meets on Friday.",
      ),
      paragraph(
        "Reading: 1. Who may join? A. Everyone B. Only adults C. Nobody D. Not stated\n2. Choose TWO activities: A. Reading B. Sharing C. Swimming D. Driving\nCloze: 3. Maya ___(1)___ in the club. A. reads B. sleeps\nWord bank: take / part / learn. Use words as needed and change form if necessary: ___(1)___ ___(2)___\nGrammar: ___(3)___ (learn); ___(4)___ club\nCompletion: Fill (1) and (2): A. Reading connects us. B. We share ideas. C. The end.\nShort answer: Why do members meet?\nTranslate in context: club; takes part in; The club welcomes everyone.\n根据原文译成英语：俱乐部；参加；这个俱乐部欢迎所有人。\n根据原文表达译成英语：她昨天参加了俱乐部。\nTranslate: 太空电梯。\nIncomplete: 15. Choose the correct option: A. Friday",
        "question",
      ),
    ],
  };
  p.articles = [a];
  p.lastArticle = a.id;
  lib.projects = [p, newProject("合成学案实验 B")];
  lib.projects[1].articles = [
    {
      id: uid(),
      title: "隔离文章",
      paragraphs: [paragraph("A different project has independent answers.")],
    },
  ];
  lib.lastProject = p.id;
  lib.settings.uploadConsent = true;
  lib.settings.mode = "confirm";
  const ps = material(a),
    ref = (i, quote) => ({
      articleId: a.id,
      paragraphId: ps[i].paragraphId,
      versionId: ps[i].versionId,
      quote,
    });
  const options = (labels) =>
    labels.map((text, i) => ({
      id: `o${i}`,
      label: String.fromCharCode(65 + i),
      text,
    }));
  const item = (id, kind, response, stem, more = {}) => ({
    id,
    number: id.replace("q", ""),
    kind,
    response,
    stem,
    requirements: "",
    options: [],
    blanks: [],
    translation: null,
    sources: [],
    uncertainties: [],
    ...more,
  });
  const blank = (n, hint = "") => ({
    id: `b${n}`,
    label: String(n),
    hint,
    location: ref(2, `___(${n})___`),
  });
  const group = (id, title, items, more = {}) => ({
    id,
    articleId: a.id,
    title,
    instructions: "阅读当前材料，按要求作答。",
    raw: ps[3].text,
    sources: [ref(3, ps[3].text)],
    options: [],
    reuse: "unknown",
    inflect: "unknown",
    items,
    ...more,
  });
  const groups = [
    group("reading", "阅读理解", [
      item("q1", "reading", "single", "Who may join?", {
        options: options(["Everyone", "Only adults", "Nobody", "Not stated"]),
      }),
      item("q2", "reading", "multiple", "Choose TWO activities.", {
        options: options(["Reading", "Sharing", "Swimming", "Driving"]),
      }),
    ]),
    group("cloze", "完形填空", [
      item("q3", "cloze", "single", "Maya ___(1)___ in the club.", {
        options: options(["reads", "sleeps"]),
        blanks: [blank(1)],
      }),
    ]),
    group(
      "bank",
      "选词填空",
      [
        item("q4", "word_bank", "blanks", "Complete the two adjacent blanks.", {
          blanks: [blank(1), blank(2)],
        }),
      ],
      {
        options: options(["take", "part", "learn"]),
        reuse: "yes",
        inflect: "yes",
      },
    ),
    group("grammar", "语法填空", [
      item("q5", "grammar", "blanks", "Complete the sentence.", {
        blanks: [blank(3, "learn"), blank(4)],
      }),
    ]),
    group(
      "completion",
      "句段补全",
      [
        item(
          "q6",
          "completion",
          "blanks",
          "Choose suitable sentences for each position.",
          { blanks: [blank(1), blank(2)] },
        ),
      ],
      {
        options: options([
          "Reading connects us.",
          "We share ideas.",
          "The end.",
        ]),
        reuse: "no",
      },
    ),
    group("short", "阅读简答", [
      item("q7", "short_answer", "text", "Why do members meet?"),
    ]),
    group("translation", "语境翻译", []),
    group("fallback", "缺失与通用回退", [
      item("q15", "reading", "single", "Choose the correct option.", {
        number: "",
        options: options(["Friday"]),
        uncertainties: ["其余选项缺失"],
      }),
      item(
        "q16",
        "judgment",
        "text",
        "The club welcomes everyone. True or false?",
      ),
      item("q17", "matching", "matching", "Match activities to descriptions.", {
        blanks: [blank(1), blank(2)],
        options: options(["Read stories", "Share ideas"]),
      }),
    ]),
  ];
  let n = 8;
  for (const direction of ["en_zh", "zh_en"])
    for (const [i, unit] of ["word", "phrase", "sentence"].entries())
      groups[6].items.push(
        item(
          `q${n++}`,
          "translation",
          "text",
          (direction === "en_zh"
            ? ["club", "takes part in", "The club welcomes everyone."]
            : ["俱乐部", "参加", "这个俱乐部欢迎所有人。"])[i],
          {
            translation: { direction, unit, useSource: "yes" },
            sources: [
              {
                ...ref(
                  0,
                  ["club", "takes part in", "The club welcomes everyone."][i],
                ),
                start: ps[0].text.indexOf(
                  ["club", "takes part in", "The club welcomes everyone."][i],
                ),
              },
            ],
          },
        ),
      );
  groups[6].items.push(
    item("q18", "translation", "text", "她昨天参加了俱乐部。", {
      translation: { direction: "zh_en", unit: "sentence", useSource: "yes" },
    }),
    item("q19", "translation", "text", "太空电梯", {
      translation: { direction: "zh_en", unit: "phrase", useSource: "yes" },
    }),
  );
  return { lib, p, a, groups, ref };
}
export function help(input) {
  const q = input.item,
    ps = input.paragraphs,
    p = ps[0],
    c = {
      articleId: p.articleId,
      paragraphId: p.paragraphId,
      versionId: p.versionId,
      quote: "The club welcomes everyone.",
    };
  const d = {
    itemId: q.id,
    hint: "先核对题干要求，再回到相关语境。",
    answer: "Everyone.",
    answerIds:
      !q.blanks.length && ["single", "multiple"].includes(q.response)
        ? [q.options[0].id]
        : [],
    explanation: "这是合成后端的交互测试参考解释，不代表真实模型质量。",
    uncertain: false,
    parts: q.blanks.map((b) => ({
      id: b.id,
      answer: b.hint ? "learned" : "示例答案",
      optionId:
        (q.options.length ? q.options : input.group.options)[0]?.id || null,
      basis: "rule",
      text: "依据词性、时态及上下文核对该空。",
      citations: [],
    })),
    options: (q.options.length ? q.options : input.group.options).map(
      (o, i) => ({
        id: o.id,
        relation: ["supported", "contradicted", "inference", "unmentioned"][
          i % 4
        ],
        basis: i === 3 ? "inference" : "evidence",
        text: [
          "everyone 直接支持。",
          "only adults 缩小了原文的范围。",
          "结合两处内容，需进一步推断。",
          "原文没有提及，不附虚构引用。",
        ][i % 4],
        citations:
          i === 3
            ? []
            : i === 2
              ? [
                  c,
                  {
                    articleId: ps[1].articleId,
                    paragraphId: ps[1].paragraphId,
                    versionId: ps[1].versionId,
                    quote: "This year, members will help children read.",
                  },
                ]
              : [c],
      }),
    ),
    points: [
      { basis: "evidence", text: "原文描述俱乐部欢迎所有人。", citations: [c] },
    ],
    translation: null,
  };
  if (q.kind === "translation") {
    const expression =
      q.translation.unit === "word"
        ? "club"
        : q.translation.unit === "phrase"
          ? "takes part in"
          : "The club welcomes everyone.";
    const citation = {
      ...c,
      quote: expression,
      start: p.text.indexOf(expression),
    };
    if (q.stem === "太空电梯") {
      d.answer = "space elevator";
      d.translation = {
        mode: "none",
        expression: "",
        adjustments: "没有找到可确认的原文表达，提供普通参考译法。",
        alternatives: [],
        citations: [],
      };
    } else if (q.stem === "她昨天参加了俱乐部。") {
      d.answer = "She took part in the club yesterday.";
      d.translation = {
        mode: "adapted",
        expression: "takes part in",
        adjustments: "takes 改为过去式 took，并按题意添加 yesterday。",
        alternatives: ["She joined the club yesterday."],
        citations: [{ ...c, quote: "takes part in" }],
      };
    } else {
      d.answer =
        q.translation.direction === "en_zh"
          ? {
              word: "俱乐部",
              phrase: "参加",
              sentence: "这个俱乐部欢迎所有人。",
            }[q.translation.unit]
          : expression;
      d.translation = {
        mode: q.translation.direction === "en_zh" ? "adapted" : "exact",
        expression,
        adjustments:
          q.translation.direction === "en_zh"
            ? "按当前语境自然译成中文。"
            : "无需调整，直接采用原文表达。",
        alternatives: [],
        citations: [citation],
      };
    }
  }
  return d;
}
export function seedStructured() {
  const f = fixture();
  f.p.worksheets = validateGroups({ groups: f.groups }, f.a);
  return f;
}
