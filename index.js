import {
    DEFAULT_SETTINGS, LENGTH_PRESETS, THINKING_PRESETS,
    applyGenerationControls, countBodyCharacters, getLengthRange, isSupportedConnection,
} from './core.mjs';

const KEY = 'poiozjy_reply_control';
const context = SillyTavern.getContext();
let button;
let panel;
let quickPanel;
let longPressTimer;
let leftObserver;
let suppressClick = false;
let lastControlledRequest = false;

function getSettings() {
    const root = context.extensionSettings;
    root[KEY] ??= {};
    for (const [name, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(root[KEY], name)) root[KEY][name] = value;
    }
    return root[KEY];
}

function save() {
    context.saveSettingsDebounced();
    refreshUi();
}

function connectionOk() {
    const current = SillyTavern.getContext();
    return isSupportedConnection(current.mainApi, {
        chat_completion_source: current.chatCompletionSettings?.chat_completion_source,
        model: current.chatCompletionSettings?.deepseek_model,
    });
}

function refreshUi() {
    const settings = getSettings();
    if (button) {
        button.classList.toggle('rc-enabled', Boolean(settings.enabled));
        button.setAttribute('aria-pressed', String(Boolean(settings.enabled)));
        button.title = `回复控制：${settings.enabled ? '已开启' : '已关闭'}。点击切换；长按或右键打开设置`;
    }
    for (const root of [panel, quickPanel]) {
        if (!root) continue;
        const enable = root.querySelector('[data-rc="enabled"]');
        const length = root.querySelector('[data-rc="length"]');
        const target = root.querySelector('[data-rc="target"]');
        const thought = root.querySelector('[data-rc="thinking"]');
        const outline = root.querySelector('[data-rc="outline"]');
        const status = root.querySelector('[data-rc="status"]');
        enable.checked = Boolean(settings.enabled);
        length.value = settings.lengthPreset;
        target.value = settings.customTarget;
        target.disabled = settings.lengthPreset !== 'custom';
        thought.value = settings.thinkingPreset;
        outline.checked = Boolean(settings.expandOutline);
        status.textContent = connectionOk()
            ? 'DeepSeek V4 Pro 官方连接已就绪。思考档位控制强度，不强制计时。'
            : '当前连接不是 DeepSeek V4 Pro 官方接口；插件不会改动其他模型的请求。';
        const range = getLengthRange(settings);
        root.querySelector('[data-rc="range"]').textContent = `正文目标：${range.min}～${range.max} 字`;
    }
}

function controlsHtml() {
    const lengthOptions = Object.entries(LENGTH_PRESETS)
        .map(([key, item]) => `<option value="${key}">${item.label} · ${item.min}～${item.max}</option>`).join('');
    const thinkingOptions = Object.entries(THINKING_PRESETS)
        .map(([key, item]) => `<option value="${key}">${item.label} · ${item.hint}</option>`).join('');
    return `<div class="rc-form">
        <label class="rc-switch"><input type="checkbox" data-rc="enabled"> 启用回复控制</label>
        <label>正文长度<select data-rc="length">${lengthOptions}<option value="custom">自定义</option></select></label>
        <label>自定义目标字数<input data-rc="target" type="number" min="100" max="30000" step="1"></label>
        <small data-rc="range"></small>
        <label>思考档位<select data-rc="thinking">${thinkingOptions}</select></label>
        <label class="rc-switch"><input type="checkbox" data-rc="outline"> 展开缩略剧情，不跳过概述中的事件</label>
        <small data-rc="status" role="status"></small>
        <small>字数只统计正文。档位中的秒数是体验参考，不会空等或强行打断生成。</small>
    </div>`;
}

function bindControls(root) {
    root.addEventListener('change', event => {
        const key = event.target?.dataset?.rc;
        const settings = getSettings();
        if (key === 'enabled') settings.enabled = event.target.checked;
        if (key === 'length') settings.lengthPreset = event.target.value;
        if (key === 'thinking') settings.thinkingPreset = event.target.value;
        if (key === 'outline') settings.expandOutline = event.target.checked;
        if (key === 'target') settings.customTarget = Math.max(100, Math.min(30000, Math.round(Number(event.target.value) || 1800)));
        save();
    });
}

function closeQuickPanel() {
    quickPanel?.remove();
    quickPanel = null;
}

function openQuickPanel() {
    if (!button) return;
    closeQuickPanel();
    quickPanel = document.createElement('section');
    quickPanel.className = 'rc-quick-panel';
    quickPanel.setAttribute('aria-label', '回复控制设置');
    quickPanel.innerHTML = `<div class="rc-quick-heading">回复控制 <button type="button" data-rc-close aria-label="关闭设置">×</button></div>${controlsHtml()}`;
    document.body.append(quickPanel);
    bindControls(quickPanel);
    quickPanel.querySelector('[data-rc-close]').addEventListener('click', closeQuickPanel);
    const rect = button.getBoundingClientRect();
    quickPanel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - quickPanel.offsetWidth - 8))}px`;
    if (rect.top > 210 || rect.top > window.innerHeight - rect.bottom) {
        quickPanel.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 8)}px`;
        quickPanel.style.maxHeight = `${Math.max(120, rect.top - 16)}px`;
    } else {
        quickPanel.style.top = `${rect.bottom + 8}px`;
        quickPanel.style.maxHeight = `${Math.max(120, window.innerHeight - rect.bottom - 16)}px`;
    }
    refreshUi();
}

function mountUi() {
    const left = document.querySelector('#leftSendForm');
    if (!left) return false;
    if (!button) {
        button = document.createElement('button');
        button.id = 'poiozjy-reply-control-toggle';
        button.type = 'button';
        button.className = 'fa-solid fa-sliders rc-toggle interactable';
        button.setAttribute('aria-label', '切换回复控制');
        button.addEventListener('click', () => {
            if (suppressClick) { suppressClick = false; return; }
            getSettings().enabled = !getSettings().enabled;
            save();
            if (getSettings().enabled && !connectionOk()) {
                toastr.warning('请在 Chat Completion 中选择 DeepSeek 官方的 V4 Pro 模型。');
            }
        });
        button.addEventListener('contextmenu', event => {
            event.preventDefault();
            openQuickPanel();
        });
        button.addEventListener('pointerdown', event => {
            if (event.pointerType !== 'touch') return;
            longPressTimer = window.setTimeout(() => {
                suppressClick = true;
                openQuickPanel();
                window.setTimeout(() => { suppressClick = false; }, 900);
            }, 550);
        });
        for (const name of ['pointerup', 'pointercancel', 'pointerleave']) {
            button.addEventListener(name, () => window.clearTimeout(longPressTimer));
        }
        button.addEventListener('keydown', event => {
            if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); openQuickPanel(); }
        });
    }
    const wand = left.querySelector('#extensionsMenuButton');
    if (wand) wand.after(button);
    else left.append(button);
    if (!wand && !leftObserver) {
        leftObserver = new MutationObserver(() => {
            const currentWand = left.querySelector('#extensionsMenuButton');
            if (currentWand) {
                currentWand.after(button);
                leftObserver.disconnect();
                leftObserver = null;
            }
        });
        leftObserver.observe(left, { childList: true });
    }

    const settingsContainer = document.querySelector('#extensions_settings2');
    if (settingsContainer && !panel) {
        panel = document.createElement('div');
        panel.id = 'poiozjy-reply-control-settings';
        panel.innerHTML = `<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>回复控制</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content">${controlsHtml()}</div></div>`;
        settingsContainer.append(panel);
        bindControls(panel);
        panel.querySelector('.inline-drawer-toggle').addEventListener('click', () => {
            panel.querySelector('.inline-drawer-content').classList.toggle('rc-collapsed');
        });
    }
    refreshUi();
    return true;
}

context.eventSource.on(context.eventTypes.CHAT_COMPLETION_SETTINGS_READY, request => {
    lastControlledRequest = applyGenerationControls(request, getSettings(), SillyTavern.getContext().mainApi);
});

context.eventSource.on(context.eventTypes.MESSAGE_RECEIVED, (messageId, type) => {
    if (!lastControlledRequest || type === 'quiet' || type === 'impersonate') return;
    lastControlledRequest = false;
    const message = SillyTavern.getContext().chat?.[messageId];
    if (!message || message.is_user) return;
    const count = countBodyCharacters(message.mes);
    const range = getLengthRange(getSettings());
    if (count < range.min || count > range.max) {
        toastr.info(`本次正文约 ${count} 字，目标 ${range.min}～${range.max} 字。可续写或重生成。`, '回复控制');
    }
});

for (const eventName of ['APP_READY', 'APP_INITIALIZED', 'CHATCOMPLETION_SOURCE_CHANGED', 'CHATCOMPLETION_MODEL_CHANGED', 'MAIN_API_CHANGED']) {
    const event = context.eventTypes[eventName];
    if (event) context.eventSource.on(event, mountUi);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountUi, { once: true });
else mountUi();

document.addEventListener('pointerdown', event => {
    if (quickPanel && !quickPanel.contains(event.target) && event.target !== button) closeQuickPanel();
});
