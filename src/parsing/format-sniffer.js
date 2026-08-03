OTA.define('format-sniffer', ["table-utils"], ({TableUtils}) => {
/* FormatSniffer — 基于统计指纹的单次扫描格式检测
 *
 * 核心原理：
 *   每种表格格式在文本前 4KB 中留下独特的统计指纹。
 *   一次扫描提取特征向量 → 声明式签名匹配 → 一击命中。
 *
 * 设计约束：
 *   - 只扫描前 4KB / 50 行，不解析全文
 *   - 单次遍历，O(n) 时间，O(1) 空间（Welford 增量算法）
 *   - 纯函数，不依赖 DOM、Worker 或浏览器 API
 *   - require 门控：格式必须满足的正面特征，缺则直接排除
 */

// ── Welford 在线统计算法 ──────────────────────────────────────────
function createWelford() {
    return { mean: 0, m2: 0, count: 0 };
}
function welfordAdd(w, value) {
    w.count++;
    const delta = value - w.mean;
    w.mean += delta / w.count;
    w.m2 += delta * (value - w.mean);
}
function welfordVariance(w) {
    return w.count > 1 ? w.m2 / w.count : 0;
}

// ── 格式签名库 ────────────────────────────────────────────────────

const SIGNATURES = [
    // ═══ 硬特征格式：100% 确定，不参与打分 ═══
    {
        id: 'html-table',
        label: 'HTML 网页表格',
        hard: ['M_html'],
        priority: 100,
    },
    {
        id: 'cli-table-data',
        label: 'CLI table-data',
        hard: ['M_cliTableData'],
        priority: 100,
    },
    {
        id: 'data-block',
        label: 'Data-Block 数据块',
        // 不是硬特征：不完整的 data-block（缺闭合 ]）需 probe-parse 验证
        require: ['M_dataBlock'],
        soft: [
            { f: 'M_dataBlock',  w: 1.0, op: 'nonzero' },
        ],
        priority: 95,
    },

    // ═══ 分隔符格式 — 必须包含对应分隔符 ═══
    {
        id: 'excel-paste',
        label: 'Excel/表格复制 TSV',
        require: ['D_tab_present'],
        soft: [
            { f: 'D_tab_mean',       w: 0.35, op: 'gt',  v: 0 },
            { f: 'D_tab_variance',   w: 0.30, op: 'lt',  v: 0.10 },
            { f: 'D_comma_mean',     w: 0.15, op: 'lt',  v: 3 },
            { f: 'S_emptyLineRatio', w: 0.10, op: 'lt',  v: 0.15 },
            { f: 'Q_embeddedNL',     w: 0.10, op: 'zero' },
        ],
        conflicts: ['M_mdSep', 'M_asciiBorder', 'M_alignedSep', 'M_cliBlockSep'],
        priority: 85,
    },
    {
        id: 'csv',
        label: 'CSV',
        require: ['D_comma_present'],
        soft: [
            { f: 'D_comma_mean',       w: 0.30, op: 'gt', v: 0 },
            { f: 'D_comma_variance',   w: 0.30, op: 'lt', v: 0.18 },
            { f: 'D_tab_present',      w: 0.20, op: 'zero' },
            { f: 'D_semicolon_mean',   w: 0.10, op: 'lt', v: 1.5 },
            { f: 'Q_escapedQuotes',    w: 0.05, op: 'nonzero' },  // CSV 常含转义引号
            { f: 'S_emptyLineRatio',   w: 0.05, op: 'lt', v: 0.2 },
        ],
        conflicts: ['M_mdSep', 'M_asciiBorder', 'M_alignedSep', 'M_cliBlockSep'],
        priority: 75,
    },
    {
        id: 'semicolon-csv',
        label: '分号分隔 CSV',
        require: ['D_semicolon_present'],
        soft: [
            { f: 'D_semicolon_mean',     w: 0.35, op: 'gt', v: 0 },
            { f: 'D_semicolon_variance', w: 0.30, op: 'lt', v: 0.15 },
            { f: 'D_comma_mean',         w: 0.15, op: 'lt', v: 2.5 },
            { f: 'D_tab_present',        w: 0.15, op: 'zero' },
            { f: 'S_emptyLineRatio',     w: 0.05, op: 'lt', v: 0.2 },
        ],
        conflicts: ['M_mdSep', 'M_asciiBorder'],
        priority: 70,
    },

    // ═══ 竖线格式 ═══
    {
        id: 'pipe-table',
        label: 'Markdown 竖线表格',
        require: ['D_pipe_present'],
        soft: [
            { f: 'M_mdSep',           w: 0.40, op: 'nonzero' },
            { f: 'D_pipe_mean',       w: 0.20, op: 'gt', v: 0 },
            { f: 'D_pipe_variance',   w: 0.15, op: 'lt', v: 0.15 },
            { f: 'D_tab_present',     w: 0.10, op: 'zero' },
            { f: 'D_comma_mean',      w: 0.10, op: 'lt', v: 3 },
            { f: 'S_emptyLineRatio',  w: 0.05, op: 'lt', v: 0.3 },
        ],
        conflicts: ['M_asciiBorder', 'M_cliBlockSep'],
        priority: 82,
    },
    {
        id: 'ascii-table',
        label: 'ASCII 终端表格',
        // 管道符存在 或 检测到边框字符
        requireAny: [['D_pipe_present'], ['M_asciiBorder']],
        soft: [
            { f: 'M_asciiBorder',    w: 0.50, op: 'nonzero' },
            { f: 'D_pipe_mean',      w: 0.20, op: 'gt', v: 0 },
            { f: 'D_pipe_variance',  w: 0.15, op: 'lt', v: 0.2 },
            { f: 'D_tab_present',    w: 0.10, op: 'zero' },
            { f: 'S_emptyLineRatio', w: 0.05, op: 'lt', v: 0.4 },
        ],
        conflicts: ['M_cliBlockSep'],
        priority: 78,
    },

    // ═══ 无分隔符/位置对齐格式 ═══
    {
        id: 'aligned-table',
        label: '定宽对齐文本',
        // 必须同时有分隔线和多空格列对齐
        require: ['M_alignedSep', 'D_multiSpace_present'],
        soft: [
            { f: 'M_alignedSep',          w: 0.35, op: 'nonzero' },
            { f: 'S_rowLengthVariance',   w: 0.15, op: 'lt',  v: 30 },
            { f: 'D_multiSpace_mean',     w: 0.15, op: 'gt',  v: 0 },
            { f: 'D_tab_present',         w: 0.15, op: 'zero' },
            { f: 'D_comma_mean',          w: 0.10, op: 'lt',  v: 3 },
            { f: 'D_pipe_mean',           w: 0.10, op: 'lt',  v: 2 },
        ],
        // CLI 多块表有自己的 === 分隔线，不要混淆
        conflicts: ['M_asciiBorder', 'M_mdSep', 'M_cliBlockSep'],
        priority: 65,
    },
    {
        id: 'cli-multi-block',
        label: 'CLI 多块定宽表',
        require: ['M_cliBlockSep'],
        soft: [
            { f: 'M_cliBlockSep',       w: 0.35, op: 'nonzero' },
            { f: 'S_emptyLineRatio',    w: 0.25, op: 'gt',  v: 0.02 },
            { f: 'S_rowLengthVariance', w: 0.15, op: 'lt',  v: 30 },
            { f: 'D_tab_present',       w: 0.15, op: 'zero' },
            { f: 'D_pipe_mean',         w: 0.10, op: 'lt',  v: 2 },
        ],
        priority: 68,
    },
    {
        id: 'fixed-width',
        label: '固定宽度文本',
        require: ['D_multiSpace_present'],
        soft: [
            { f: 'D_multiSpace_mean',     w: 0.30, op: 'gt', v: 0 },
            { f: 'D_multiSpace_variance', w: 0.25, op: 'lt', v: 0.5 },
            { f: 'D_tab_present',         w: 0.15, op: 'zero' },
            { f: 'D_comma_mean',          w: 0.10, op: 'lt', v: 3 },
            { f: 'D_pipe_mean',           w: 0.10, op: 'lt', v: 2 },
            { f: 'S_rowLengthVariance',   w: 0.10, op: 'lt', v: 40 },
        ],
        conflicts: ['M_alignedSep', 'M_asciiBorder', 'M_mdSep', 'M_cliBlockSep', 'M_cliTableData'],
        priority: 55,
    },

    // ═══ 兜底 — 仅在没有任何可识别结构时才触发 ═══
    {
        id: 'plain-text',
        label: '空白分隔纯文本',
        soft: [
            { f: 'D_multiSpace_mean',    w: 0.30, op: 'gt', v: 0 },
            { f: 'D_tab_present',        w: 0.30, op: 'zero' },
            { f: 'D_comma_mean',         w: 0.20, op: 'lt', v: 2 },
            { f: 'D_semicolon_mean',     w: 0.10, op: 'lt', v: 1 },
            { f: 'S_emptyLineRatio',     w: 0.10, op: 'lt', v: 0.3 },
        ],
        // 任何可识别结构存在时，plain-text 都应让位
        conflicts: ['M_html', 'M_cliTableData', 'M_dataBlock',
                     'M_mdSep', 'M_asciiBorder', 'M_alignedSep', 'M_cliBlockSep',
                     'D_tab_present', 'D_comma_present', 'D_semicolon_present',
                     'D_pipe_present', 'D_multiSpace_present'],
        priority: 0,
    },
];

// ── 特征提取器 ────────────────────────────────────────────────────

const MAX_SCAN_BYTES = 4096;
const MAX_SCAN_LINES = 50;
const MIN_LINES_FOR_HIGH_CONFIDENCE = 3;

function extractFeatures(rawText) {
    const text = typeof rawText === 'string' ? rawText : '';
    const chunk = text.length > MAX_SCAN_BYTES ? text.slice(0, MAX_SCAN_BYTES) : text;

    const f = {
        M_html: false,
        M_cliTableData: false,
        M_dataBlock: false,
        M_mdSep: false,
        M_asciiBorder: false,
        M_cliBlockSep: false,
        M_alignedSep: false,

        D_tab: createWelford(),
        D_comma: createWelford(),
        D_semicolon: createWelford(),
        D_pipe: createWelford(),
        D_multiSpace: createWelford(),

        S_rowLen: createWelford(),
        S_emptyLineCount: 0,
        Q_escapedQuotes: false,
        Q_embeddedNL: false,
        Q_quotedFieldCount: 0,
        Q_totalFieldCount: 0,

        lineCount: 0,
        nonEmptyLineCount: 0,
        truncated: text.length > MAX_SCAN_BYTES,
    };

    let inQuotes = false;
    let currentDelims = { tab: 0, comma: 0, semicolon: 0, pipe: 0, multiSpace: 0 };
    let currentLineLen = 0;
    let consecutiveSpaces = 0;
    let currentLineNonSpace = false;
    // 行缓冲区，用于回溯检测结构标记
    let lineBuf = '';

    const finalizeLine = () => {
        if (consecutiveSpaces >= 2) currentDelims.multiSpace++;
        consecutiveSpaces = 0;

        if (currentLineNonSpace) {
            welfordAdd(f.S_rowLen, currentLineLen);
            welfordAdd(f.D_tab, currentDelims.tab);
            welfordAdd(f.D_comma, currentDelims.comma);
            welfordAdd(f.D_semicolon, currentDelims.semicolon);
            welfordAdd(f.D_pipe, currentDelims.pipe);
            welfordAdd(f.D_multiSpace, currentDelims.multiSpace);
            f.Q_totalFieldCount += currentDelims.tab + currentDelims.comma
                                 + currentDelims.semicolon + currentDelims.pipe
                                 + currentDelims.multiSpace + 1;
            f.nonEmptyLineCount++;

            // 在当前行检测结构标记
            detectStructuralMarkers(f, lineBuf);
        } else {
            f.S_emptyLineCount++;
        }
        f.lineCount++;

        currentDelims = { tab: 0, comma: 0, semicolon: 0, pipe: 0, multiSpace: 0 };
        currentLineLen = 0;
        currentLineNonSpace = false;
        lineBuf = '';
    };

    let i = 0;
    for (i = 0; i < chunk.length && f.lineCount < MAX_SCAN_LINES; i++) {
        const ch = chunk[i];
        currentLineLen++;
        lineBuf += ch;
        if (ch !== ' ' && ch !== '\t' && ch !== '\r') currentLineNonSpace = true;

        // ── 硬标记检测 ──
        if (!f.M_html && ch === '<' && /^<table[\s>]/i.test(chunk.slice(i, i + 10))) {
            f.M_html = true;
        }
        if (!f.M_cliTableData && ch === 't' && /^table[-_]data\b/i.test(chunk.slice(i, i + 20))) {
            f.M_cliTableData = true;
        }
        if (!f.M_dataBlock && ch === 'd' && /^data\s+\S+.*\[/m.test(chunk.slice(Math.max(0, i - 5), i + 30))) {
            f.M_dataBlock = true;
        }

        // ── 引号状态机 ──
        if (ch === '"') {
            if (inQuotes) {
                if (chunk[i + 1] === '"') {
                    f.Q_escapedQuotes = true;
                    i++;
                    continue;
                }
                inQuotes = false;
            } else {
                inQuotes = true;
                f.Q_quotedFieldCount++;
            }
            continue;
        }

        if (inQuotes && ch === '\n') {
            f.Q_embeddedNL = true;
        }

        // ── 分隔符计数（引号内不计） ──
        if (!inQuotes) {
            if (ch === '\t') currentDelims.tab++;
            if (ch === ',') currentDelims.comma++;
            if (ch === ';') currentDelims.semicolon++;
            if (ch === '|') currentDelims.pipe++;
        }

        // ── 连续空格计数 ──
        if (ch === ' ') {
            consecutiveSpaces++;
        } else if (ch !== '\t') {
            if (consecutiveSpaces >= 2) currentDelims.multiSpace++;
            consecutiveSpaces = 0;
        }

        // ── 换行：收束当前行 ──
        if (ch === '\n') {
            finalizeLine();
        }
    }

    // 最后一行（无结尾换行）
    if (currentLineLen > 0) {
        finalizeLine();
    }

    return f;
}

// ── 结构标记检测（逐行回溯） ──────────────────────────────────────

function detectStructuralMarkers(f, line) {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Markdown 分隔线：|:---|:---:| 或 |---|---|
    if (!f.M_mdSep && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)) {
        f.M_mdSep = true;
    }

    // ASCII 边框：含 + 或框线字符，且以这些字符开头或结尾
    if (!f.M_asciiBorder && /^[\s+|\-─┌┬┐├┼┤└┴┘│=]+$/.test(line)
        && /[+┌┬┐├┼┤└┴┘]/.test(line)) {
        const t = trimmed;
        if (/^[+┌┬┐├┼┤└┴┘]/.test(t) || /[+┌┬┐├┼┤└┴┘]$/.test(t)) {
            f.M_asciiBorder = true;
        }
    }

    // CLI 块分隔线：以 = 为主（允许 | 穿插），长度 >= 10 且 = 占比 >= 60%
    if (!f.M_cliBlockSep) {
        const compact = trimmed.replace(/\s/g, '');
        if (compact.length >= 10) {
            const eqCount = (compact.match(/=/g) || []).length;
            if (eqCount / compact.length >= 0.6 && /^[=|]+$/.test(compact)) {
                f.M_cliBlockSep = true;
            }
        }
    }

    // 对齐文本分隔线：--- 或 +--+--
    // 阈值设为 3，因为常见 CLI 对齐表的分隔线就是 "---"
    if (!f.M_alignedSep) {
        const compact = trimmed.replace(/\s/g, '');
        // 纯 - 组成的行，长度 >= 3（如 "---" 或 "----------"）
        if (/^-{3,}$/.test(compact)) {
            f.M_alignedSep = true;
        }
        // 含 + 和 - 的分隔线（如 "+---+---+---"）
        if (/\+[\s-]*\+/.test(trimmed) && trimmed.replace(/[^\-]/g, '').length >= 3) {
            f.M_alignedSep = true;
        }
    }
}

// ── 特征向量规范化 ────────────────────────────────────────────────

function normalizeFeatures(f) {
    const present = (w) => w.mean > 0.15;

    return {
        M_html: f.M_html,
        M_cliTableData: f.M_cliTableData,
        M_dataBlock: f.M_dataBlock,
        M_mdSep: f.M_mdSep,
        M_asciiBorder: f.M_asciiBorder,
        M_cliBlockSep: f.M_cliBlockSep,
        M_alignedSep: f.M_alignedSep,

        D_tab_mean: f.D_tab.mean,
        D_tab_variance: welfordVariance(f.D_tab),
        D_tab_present: present(f.D_tab),
        D_comma_mean: f.D_comma.mean,
        D_comma_variance: welfordVariance(f.D_comma),
        D_comma_present: present(f.D_comma),
        D_semicolon_mean: f.D_semicolon.mean,
        D_semicolon_variance: welfordVariance(f.D_semicolon),
        D_semicolon_present: present(f.D_semicolon),
        D_pipe_mean: f.D_pipe.mean,
        D_pipe_variance: welfordVariance(f.D_pipe),
        D_pipe_present: present(f.D_pipe),
        D_multiSpace_mean: f.D_multiSpace.mean,
        D_multiSpace_variance: welfordVariance(f.D_multiSpace),
        D_multiSpace_present: present(f.D_multiSpace),

        S_rowLengthVariance: welfordVariance(f.S_rowLen),
        S_emptyLineRatio: f.lineCount > 0 ? f.S_emptyLineCount / f.lineCount : 0,

        Q_escapedQuotes: f.Q_escapedQuotes,
        Q_embeddedNL: f.Q_embeddedNL,
        Q_quotedFieldRatio: f.Q_totalFieldCount > 0
            ? f.Q_quotedFieldCount / f.Q_totalFieldCount
            : 0,

        lineCount: f.lineCount,
        nonEmptyLineCount: f.nonEmptyLineCount,
        truncated: f.truncated,
    };
}

// ── 软规则匹配 ────────────────────────────────────────────────────

function matchRule(actual, rule) {
    const { op, v } = rule;

    switch (op) {
        case 'gt':
            if (actual > v) return 1;
            if (v > 0) return Math.max(0, actual / v);
            return actual > 0 ? 0.5 : 0;

        case 'lt':
            if (actual < v) return 1;
            if (actual > 0) return Math.max(0, v / actual);
            return v > 0 ? 0 : 1;

        case 'zero':
            if (actual === 0 || actual === false) return 1;
            if (typeof actual === 'number') return Math.max(0, 1 - Math.min(1, actual));
            return actual ? 0 : 1;

        case 'nonzero':
            if (typeof actual === 'boolean') return actual ? 1 : 0;
            return actual !== 0 && actual !== false ? 1 : 0;

        case 'eq':
            return actual === v ? 1 : 0;

        default:
            return 0;
    }
}

function checkRequire(sig, nf) {
    // require: 所有特征必须为 truthy
    if (sig.require) {
        for (const feat of sig.require) {
            if (!nf[feat]) return false;
        }
    }
    // requireAny: 至少一组全部满足
    if (sig.requireAny) {
        let anyOk = false;
        for (const group of sig.requireAny) {
            if (group.every(feat => nf[feat])) {
                anyOk = true;
                break;
            }
        }
        if (!anyOk) return false;
    }
    return true;
}

function scoreSoft(sig, nf) {
    // 门控检查：必需特征不满足 → 直接 0 分
    if (!checkRequire(sig, nf)) return 0;

    // 互斥约束
    if (sig.conflicts) {
        for (const conflict of sig.conflicts) {
            if (nf[conflict]) return 0;
        }
    }

    if (!sig.soft || sig.soft.length === 0) return 0;

    let totalWeight = 0;
    let score = 0;

    for (const rule of sig.soft) {
        const actual = nf[rule.f];
        if (actual === undefined || actual === null) continue;
        const matched = matchRule(actual, rule);
        score += matched * rule.w;
        totalWeight += rule.w;
    }

    return totalWeight > 0 ? score / totalWeight : 0;
}

// ── 公共 API ──────────────────────────────────────────────────────

const FormatSniffer = {
    /**
     * 对输入文本进行格式嗅探。
     *
     * @param {string} text - 原始输入文本
     * @returns {{ candidates: Array, diagnostics: Array, features: Object }}
     */
    sniff(text) {
        const trimmed = (text || '').trim();
        if (!trimmed) {
            return {
                candidates: [],
                diagnostics: [{ level: 'info', code: 'EMPTY_INPUT', message: '输入为空' }],
                features: null,
            };
        }

        const rawFeatures = extractFeatures(text);
        const nf = normalizeFeatures(rawFeatures);
        const diagnostics = [];

        if (nf.nonEmptyLineCount < MIN_LINES_FOR_HIGH_CONFIDENCE) {
            diagnostics.push({
                level: 'info',
                code: 'LOW_SAMPLE',
                message: `仅 ${nf.nonEmptyLineCount} 行有效数据，格式检测置信度较低`,
            });
        }

        // ── 第一步：硬特征匹配 ──
        for (const sig of SIGNATURES) {
            if (sig.hard && sig.hard.some(f => nf[f])) {
                return {
                    candidates: [{
                        id: sig.id,
                        label: sig.label,
                        score: 1.0,
                        method: 'hard',
                        reason: `硬特征命中: ${sig.hard.filter(h => nf[h]).join(', ')}`,
                    }],
                    diagnostics,
                    features: nf,
                };
            }
        }

        // ── 第二步：软特征打分 ──
        let scored = SIGNATURES
            .filter(s => !s.hard)
            .map(sig => {
                const score = scoreSoft(sig, nf);
                const reasons = [];
                if (!checkRequire(sig, nf)) {
                    reasons.push('门控未通过');
                } else if (sig.conflicts) {
                    for (const c of sig.conflicts) {
                        if (nf[c]) reasons.push(`互斥 ${c}`);
                    }
                }
                return {
                    id: sig.id,
                    label: sig.label,
                    score,
                    method: score > 0 ? 'soft' : 'gated',
                    reason: reasons.join('; ') || `得分 ${score.toFixed(3)}`,
                    priority: sig.priority || 0,
                };
            })
            .filter(c => c.score > 0.05)
            .sort((a, b) => {
                if (Math.abs(b.score - a.score) > 0.05) return b.score - a.score;
                return (b.priority || 0) - (a.priority || 0);
            });

        // 低样本量降权
        if (nf.nonEmptyLineCount < MIN_LINES_FOR_HIGH_CONFIDENCE) {
            scored = scored.map(c => ({
                ...c,
                score: Math.min(c.score, 0.70),
                method: 'soft_low_sample',
            }));
        }

        // ── 第三步：兜底 ──
        if (scored.length === 0) {
            scored = [{
                id: 'plain-text',
                label: '空白分隔纯文本',
                score: 0.45,
                method: 'fallback',
                reason: '无匹配格式',
                priority: 0,
            }];
        }

        // 歧义诊断
        if (scored.length >= 2 && scored[0].score - scored[1].score < 0.12) {
            diagnostics.push({
                level: 'info',
                code: 'FORMAT_AMBIGUOUS',
                message: `候选接近：${scored[0].label}(${scored[0].score.toFixed(2)}) vs ${scored[1].label}(${scored[1].score.toFixed(2)})`,
            });
        }

        return { candidates: scored, diagnostics, features: nf };
    },

    /** 暴露特征提取（供测试验证） */
    extractFeatures: extractFeatures,
    normalizeFeatures: normalizeFeatures,

    signatureCount: SIGNATURES.length,

    getFormatIds() {
        return SIGNATURES.map(s => s.id);
    },
};

    return { FormatSniffer };
});
