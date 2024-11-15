// llm_translate/index.js

export { llmTranslate };

import {
    eventSource,
    event_types,
    getRequestHeaders,
    reloadCurrentChat,
    saveSettingsDebounced,
    substituteParams,
    updateMessageBlock,
} from '../../../../script.js';

import { extension_settings, getContext } from '../../../extensions.js';
import { SECRET_KEYS, secret_state } from '../../../secrets.js';

const extensionName = "llm-translator3";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

let extensionSettings = extension_settings[extensionName];
if (!extensionSettings) {
    extensionSettings = {};
    extension_settings[extensionName] = extensionSettings;
}

const defaultSettings = {
    llm_provider: 'openai',
    llm_model: 'gpt-3.5-turbo',
    llm_prompt: 'Please translate the following text:',
    auto_mode: false,
};

// LLM 번역 함수
async function llmTranslate(text) {
    // OpenAI API 키가 설정되어 있는지 확인
    if (!secret_state[SECRET_KEYS.OPENAI]) {
        throw new Error('OpenAI API key is not set in secrets.json');
    }

    const provider = extensionSettings.llm_provider;
    const model = extensionSettings.llm_model;
    const prompt = extensionSettings.llm_prompt;
    const fullPrompt = `${prompt}\n\n"${text}"`;

    // '/api/openai/chat/completions' 엔드포인트 사용
    const response = await fetch('/api/openai/chat/completions', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            messages: [{
                role: 'user',
                content: fullPrompt
            }],
            model: model,
            temperature: 0.7,
            max_tokens: 500,
            stream: false
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Translation failed: ${errorText}`);
    }

    const result = await response.json();
    return result.choices[0].message.content.trim();
}

// 나머지 코드는 그대로 유지...

// 메시지 번역 및 업데이트 함수
async function translateMessage(messageId) {
    const context = getContext();
    const message = context.chat[messageId];

    if (!message) return;

    if (typeof message.extra !== 'object') {
        message.extra = {};
    }

    // 이미 번역된 메시지는 건너뜁니다.
    if (message.extra.display_text) return;

    // 메시지의 원문을 가져옵니다.
    const originalText = substituteParams(message.mes, context.name1, message.name);
    try {
        const translation = await llmTranslate(originalText);
        message.extra.display_text = translation;
        updateMessageBlock(messageId, message);
    } catch (error) {
        console.error(error);
        toastr.error('번역에 실패하였습니다.');
    }
}

// 전체 채팅 번역 함수
async function onTranslateChatClick() {
    const context = getContext();
    const chat = context.chat;

    if (!chat || chat.length ===0) {
        toastr.warning('번역할 채팅이 없습니다.');
        return;
    }

    toastr.info('채팅 번역을 시작합니다. 잠시만 기다려주세요.');

    for (let i =0 ; i < chat.length ; i++) {
        await translateMessage(i);
    }

    await context.saveChat();
    toastr.success('채팅 번역이 완료되었습니다.');
}

// 입력 메시지 번역 함수
async function onTranslateInputMessageClick() {
    const textarea = document.getElementById('send_textarea');

    if (!(textarea instanceof HTMLTextAreaElement)) {
        return;
    }

    if (!textarea.value) {
        toastr.warning('먼저 메시지를 입력하세요.');
        return;
    }

    try {
        const translatedText = await llmTranslate(textarea.value);
        textarea.value = translatedText;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        toastr.success('입력된 메시지가 번역되었습니다.');
    } catch (error) {
        console.error(error);
        toastr.error('메시지 번역에 실패하였습니다.');
    }
}

// 번역된 메시지 삭제 함수
async function onTranslationsClearClick() {
    const confirmClear = confirm('번역된 내용을 삭제하시겠습니까?');

    if (!confirmClear) {
        return;
    }

    const context = getContext();
    const chat = context.chat;

    for (const mes of chat) {
        if (mes.extra) {
            delete mes.extra.display_text;
        }
    }

    await context.saveChat();
    await reloadCurrentChat();
    toastr.success('번역된 내용이 삭제되었습니다.');
}

// 이벤트 리스너 등록
$(document).ready(async function() {
    const html = await $.get(`${extensionFolderPath}/index.html`);
    const buttonHtml = await $.get(`${extensionFolderPath}/buttons.html`);

    $('#translate_wand_container').append(buttonHtml);
    $('#translation_container').append(html);

    // 버튼 클릭 이벤트
    $('#llm_translate_chat').off('click').on('click', onTranslateChatClick);
    $('#llm_translate_input_message').off('click').on('click', onTranslateInputMessageClick);
    $('#llm_translation_clear').off('click').on('click', onTranslationsClearClick);

    // 설정 변경 이벤트
    $('#llm_provider').off('change').on('change', function() {
        extensionSettings.llm_provider = $(this).val();
        updateModelList();
        saveSettingsDebounced();
    });

    $('#llm_model').off('change').on('change', function() {
        extensionSettings.llm_model = $(this).val();
        saveSettingsDebounced();
    });

    $('#llm_prompt').off('input').on('input', function() {
        extensionSettings.llm_prompt = $(this).val();
        saveSettingsDebounced();
    });

    loadSettings();

    // 메시지 렌더링 시 번역 적용
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, function({ messageId }) {
        translateMessage(messageId);
    });
    eventSource.on(event_types.USER_MESSAGE_RENDERED, function({ messageId }) {
        translateMessage(messageId);
    });
    eventSource.on(event_types.MESSAGE_SWIPED, function({ messageId }) {
        translateMessage(messageId);
    });
});
