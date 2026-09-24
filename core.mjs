export const LENGTH_PRESETS = Object.freeze({
    quick: { label: '快速', min: 800, max: 1000 },
    balanced: { label: '均衡', min: 1200, max: 1600 },
    story: { label: '剧情', min: 1600, max: 4000 },
    long: { label: '长篇', min: 4000, max: 8000 },
});

export const THINKING_PRESETS = Object.freeze({
    quick: { label: '快速', effort: 'low', hint: '参考：约 30 秒以内' },
    balanced: { label: '均衡', effort: 'high', hint: '参考：约 60 秒' },
    quality: { label: '质量', effort: 'max', hint: '参考：最多愿等约 3 分钟' },
});

export const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    lengthPreset: 'balanced',
    customTarget: 1800,
    thinkingPreset: 'balanced',
    expandOutline: true,
});

const IGNORED_TYPES = new Set(['quiet', 'impersonate']);

export function isSupportedConnection(mainApi, request) {
    return mainApi === 'openai'
        && request?.chat_completion_source === 'deepseek'
        && /^deepseek-v4-pro(?:$|[-_])/.test(String(request?.model ?? ''));
}

export function getLengthRange(settings) {
    if (settings.lengthPreset !== 'custom') {
        return LENGTH_PRESETS[settings.lengthPreset] ?? LENGTH_PRESETS.balanced;
    }
    const target = Math.max(100, Math.min(30000, Math.round(Number(settings.customTarget) || 1800)));
    return {
        label: '自定义',
        min: Math.floor(target * 0.95),
        max: Math.ceil(target * 1.05),
        target,
    };
}

export function buildControlPrompt(settings, request = {}) {
    const range = getLengthRange(settings);
    const lengthInstruction = range.target
        ? `正文目标约 ${range.target} 字（参考范围 ${range.min}～${range.max} 字）`
        : `正文尽量落在 ${range.min}～${range.max} 字`;
    const continuation = request.type === 'continue'
        ? '这次是续写：接续上一段正文，目标适用于合并后的整条回复；不要重写已经输出的内容。'
        : '';
    const outline = settings.expandOutline
        ? '如果用户用简短文字概述了接下来会发生的一串事件，将它们视为这一轮要呈现的情节；依照先后顺序写出过程、动作、对话和必要的过渡。在概述中的事件全部呈现之前，不要直接跳到它们结束后的时间点。遵守角色卡对人物行为和用户角色自主权的规定。'
        : '';

    return [
        '【本轮回复控制】保留并遵守既有预设、角色卡、世界观、文风和人物设定。',
        `${lengthInstruction}；只计算可见正文，不把思考内容计入。与预设中的篇幅要求冲突时，以用户此处选定的篇幅为目标；其他方面仍按预设。`,
        continuation,
        outline,
        '正文优先完整、连贯；不要为了凑字数重复句子，不要在正文中报告字数或复述这些控制规则。',
    ].filter(Boolean).join('\n');
}

export function applyGenerationControls(request, settings, mainApi) {
    if (!settings?.enabled || IGNORED_TYPES.has(request?.type) || !isSupportedConnection(mainApi, request)) {
        return false;
    }

    const effort = THINKING_PRESETS[settings.thinkingPreset]?.effort ?? 'high';
    request.include_reasoning = true;
    request.reasoning_effort = effort;

    const range = getLengthRange(settings);
    // DeepSeek counts reasoning and visible text against the same completion limit.
    // This is a capacity estimate, not a request to produce the maximum number of tokens.
    const reasoningRoom = { low: 2048, high: 8192, max: 16384 }[effort];
    const estimatedCapacity = Math.ceil(range.max * 2.2) + reasoningRoom;
    request.max_tokens = Math.min(393216, Math.max(Number(request.max_tokens) || 0, estimatedCapacity));

    if (!Array.isArray(request.messages)) request.messages = [];
    request.messages.push({ role: 'system', content: buildControlPrompt(settings, request) });
    return true;
}

export function countBodyCharacters(body) {
    if (typeof body !== 'string') return 0;
    const visible = body
        .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s/g, '');
    return Array.from(visible).length;
}
