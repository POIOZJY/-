import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_SETTINGS, applyGenerationControls, buildControlPrompt,
    countBodyCharacters, getLengthRange,
} from '../core.mjs';

function request(type = 'normal') {
    return {
        type,
        chat_completion_source: 'deepseek',
        model: 'deepseek-v4-pro',
        max_tokens: 4096,
        include_reasoning: false,
        messages: [
            { role: 'system', content: '预设：第一人称叙述、尊重人物设定。' },
            { role: 'user', content: 'A 告白，然后两人亲吻，最后在公园告别。' },
        ],
    };
}

test('native DeepSeek reasoning and scene instruction retain the original preset', () => {
    const data = request();
    const settings = { ...DEFAULT_SETTINGS, enabled: true, lengthPreset: 'story', thinkingPreset: 'quality' };
    assert.equal(applyGenerationControls(data, settings, 'openai'), true);
    assert.equal(data.include_reasoning, true);
    assert.equal(data.reasoning_effort, 'max');
    assert.equal(data.messages[0].content, '预设：第一人称叙述、尊重人物设定。');
    assert.equal(data.messages[1].content, 'A 告白，然后两人亲吻，最后在公园告别。');
    assert.equal(data.messages.length, 3);
    assert.match(data.messages[2].content, /1600～4000 字/);
    assert.match(data.messages[2].content, /事件全部呈现之前/);
    assert.ok(data.max_tokens > 4096, 'response budget needs to include thinking and long body');
});

test('disabled, other models and background generations keep requests untouched', () => {
    const cases = [
        [request(), { ...DEFAULT_SETTINGS }, 'openai'],
        [{ ...request(), model: 'deepseek-v4-flash' }, { ...DEFAULT_SETTINGS, enabled: true }, 'openai'],
        [request('quiet'), { ...DEFAULT_SETTINGS, enabled: true }, 'openai'],
        [request('impersonate'), { ...DEFAULT_SETTINGS, enabled: true }, 'openai'],
        [request(), { ...DEFAULT_SETTINGS, enabled: true }, 'textgenerationwebui'],
    ];
    for (const [data, settings, api] of cases) {
        const original = structuredClone(data);
        assert.equal(applyGenerationControls(data, settings, api), false);
        assert.deepEqual(data, original);
    }
});

test('continuation targets the combined visible reply, and custom count excludes thought', () => {
    const settings = { ...DEFAULT_SETTINGS, lengthPreset: 'custom', customTarget: 2000 };
    assert.deepEqual(getLengthRange(settings), { label: '自定义', min: 1900, max: 2100, target: 2000 });
    assert.match(buildControlPrompt(settings, { type: 'continue' }), /合并后的整条回复/);
    assert.equal(countBodyCharacters('<think>思考很多</think>你好，\n世界！'), 6);
});
