// llm_translate/index.js

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
import { SECRET_KEYS } from '../../../secrets.js';

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

// LLM 번역 함수 수정
async function llmTranslate(text) {
    const provider = extensionSettings.llm_provider;
    const model = extensionSettings.llm_model;
    const prompt = extensionSettings.llm_prompt;
    const fullPrompt = `${prompt}\n\n"${text}"`;

    let endpoint;
    let requestBody;

    if (provider === 'openai') {
        endpoint = 'https://api.openai.com/v1/chat/completions';
        requestBody = {
            model: model,
            messages: [{ 
                role: 'user', 
                content: fullPrompt
            }],
            temperature: 0.7,
            max_tokens: 1000
        };
    } else {
        throw new Error('Unsupported provider');
    }

    // API 키 확인
    const apiKey = SECRET_KEYS[provider]?.api_key;
    if (!apiKey) {
        throw new Error(`API key for ${provider} is not set`);
    }

    // API 요청
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            ...getRequestHeaders()
        },
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Translation failed (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    return result.choices[0].message.content.trim();
}

// 에러 처리 개선된 translateMessage 함수
async function translateMessage(messageId) {
    const context = getContext();
    const message = context.chat[messageId];

    if (!message) return;

    if (typeof message.extra !== 'object') {
        message.extra = {};
    }

    if (message.extra.display_text) return;

    try {
        const originalText = substituteParams(message.mes, context.name1, message.name);
        
        // 번역 시작 알림
        toastr.info('번역 중...', '', { timeOut: 2000 });
        
        const translation = await llmTranslate(originalText);
        message.extra.display_text = translation;
        updateMessageBlock(messageId, message);
        
        // 성공 알림
        toastr.success('번역 완료');
    } catch (error) {
        console.error('Translation error:', error);
        toastr.error(`번역 실패: ${error.message}`);
        
        // 에러가 API 키 관련인 경우 추가 안내
        if (error.message.includes('API key')) {
            toastr.warning('설정에서 API 키를 확인해주세요');
        }
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
