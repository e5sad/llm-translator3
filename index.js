// index.js

export { llmTranslate };

// import 구문의 경로를 수정합니다.
import {
    eventSource,
    event_types,
    getRequestHeaders,
    reloadCurrentChat,
    saveSettingsDebounced,
    substituteParams,
    updateMessageBlock,
} from '../../../public/script.js';

import { extension_settings, getContext } from '../../../../scripts/extensions.js';
import { callPopup, POPUP_TYPE } from '../../../../scripts/popup.js';

// Secrets를 관리하는 함수들을 가져옵니다.
import { findSecret, secret_state } from '../../../../scripts/secrets.js';

// 확장 프로그램의 이름과 경로를 지정합니다.
const extensionName = "llm_translate"; // 확장 프로그램의 이름
const extensionFolderPath = `/data/default-user/extensions/${extensionName}`;

// 확장 프로그램의 설정 객체 가져오기
let extensionSettings = extension_settings[extensionName];
if (!extensionSettings) {
    extensionSettings = {};
    extension_settings[extensionName] = extensionSettings;
}

// 기본 설정
const defaultSettings = {
    llm_provider: 'openai',
    llm_model: '',
    llm_prompt: 'Please translate the following text:',
    auto_mode: false,
};

// 설정 불러오기 함수
function loadSettings() {
    for (const key in defaultSettings) {
        if (!extensionSettings.hasOwnProperty(key)) {
            extensionSettings[key] = defaultSettings[key];
        }
    }

    // 설정 반영
    $('#llm_provider').val(extensionSettings.llm_provider);
    $('#llm_prompt').val(extensionSettings.llm_prompt);

    updateModelList();
}

// 모델 목록 업데이트 함수
function updateModelList() {
    const provider = $('#llm_provider').val();
    const modelSelect = $('#llm_model');
    modelSelect.empty();

    let models = [];

    switch (provider) {
        case 'openai':
            models = ['gpt‑3.5‑turbo', 'gpt‑4'];
            break;
        case 'cohere':
            models = ['command', 'command-xlarge'];
            break;
        case 'google':
            models = ['chat-bison', 'text-bison'];
            break;
        case 'anthropic':
            models = ['claude-instant', 'claude-v1'];
            break;
        default:
            models = [];
    }

    for (const model of models) {
        modelSelect.append(`<option value="${model}">${model}</option>`);
    }

    // 이전에 선택한 모델이 있으면 선택, 없으면 첫 번째 모델 선택
    const selectedModel = extensionSettings.llm_model || models[0];
    modelSelect.val(selectedModel);
    extensionSettings.llm_model = selectedModel;
}

// API 키 가져오기 함수
async function getApiKey(provider) {
    const secretKey = `${provider}_api_key`;

    // secret_state에서 키를 확인하고, 없으면 findSecret을 통해 가져옵니다.
    if (secret_state[secretKey]) {
        return await findSecret(secretKey);
    } else {
        throw new Error(`${provider}의 API 키가 설정되어 있지 않습니다.`);
    }
}

// LLM 번역 함수
async function llmTranslate(text) {
    const provider = extensionSettings.llm_provider;
    const model = extensionSettings.llm_model;
    const prompt = extensionSettings.llm_prompt;

    const fullPrompt = `${prompt}\n\n"${text}"`;

    let apiUrl = '';
    let requestBody = {};

    // API 키를 가져옵니다.
    const apiKey = await getApiKey(provider);

    switch (provider) {
        case 'openai':
            apiUrl = '/api/openai';
            requestBody = {
                apiKey: apiKey,
                model: model,
                messages: [{ role: 'user', content: fullPrompt }],
            };
            break;

        case 'cohere':
            apiUrl = '/api/cohere';
            requestBody = {
                apiKey: apiKey,
                model: model,
                prompt: fullPrompt,
            };
            break;

        case 'google':
            apiUrl = '/api/google';
            requestBody = {
                apiKey: apiKey,
                model: model,
                prompt: fullPrompt,
            };
            break;

        case 'anthropic':
            apiUrl = '/api/anthropic';
            requestBody = {
                apiKey: apiKey,
                model: model,
                prompt: fullPrompt,
            };
            break;

        default:
            throw new Error('지원하지 않는 LLM 공급자입니다.');
    }

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(requestBody),
    });

    if (response.ok) {
        const result = await response.json();
        // 공급자별로 응답 형식이 다르므로 처리 필요
        switch (provider) {
            case 'openai':
                return result.choices[0].message.content.trim();
            case 'cohere':
                return result.text.trim();
            case 'google':
                return result.candidates[0].output.trim();
            case 'anthropic':
                return result.completion.trim();
            default:
                return '';
        }
    } else {
        throw new Error(`번역 실패: ${await response.text()}`);
    }
}

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
    const userConfirmed = await callPopup('번역된 내용을 삭제하시겠습니까?', POPUP_TYPE.CONFIRM);

    if (!userConfirmed) {
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

// 템플릿 파일을 직접 로드하는 함수
async function fetchTemplate(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load template: ${url}`);
    }
    return await response.text();
}

// 이벤트 리스너 등록
$(document).ready(async function() {
    try {
        // 템플릿 파일 로드
        const html = await fetchTemplate(`${extensionFolderPath}/index.html`);
        const buttonHtml = await fetchTemplate(`${extensionFolderPath}/buttons.html`);

        // 템플릿을 DOM에 추가
        $('#translate_wand_container').append(buttonHtml);
        $('#translation_container').append(html);

        // 초기화 함수 호출
        initializeExtension();
    } catch (error) {
        console.error('Failed to load templates:', error);
    }
});

// 초기화 함수
function initializeExtension() {
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

    // 설정 불러오기
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
}
