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

// secrets.js의 import를 제거합니다.

// 확장 프로그램의 이름과 경로를 지정합니다.
const extensionName = "llm-translator3";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

let extensionSettings = extension_settings[extensionName];
if (!extensionSettings) {
    extensionSettings = {};
    extension_settings[extensionName] = extensionSettings;
}

const defaultSettings = {
    llm_provider: 'openai',
    llm_model: 'gpt‑3.5‑turbo',
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

    // 설정 적용
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
        // 다른 공급자들은 일단 그대로 둡니다.
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

    // 이전에 선택한 모델이 있으면 선택하고, 없으면 첫 번째 모델 선택
    const selectedModel = extensionSettings.llm_model || models[0];
    modelSelect.val(selectedModel);
    extensionSettings.llm_model = selectedModel;
}

// LLM 번역 함수
async function llmTranslate(text) {
    const provider = extensionSettings.llm_provider;
    const model = extensionSettings.llm_model;
    const prompt = extensionSettings.llm_prompt;

    // 입력한 프롬프트와 번역할 텍스트를 합칩니다.
    const fullPrompt = `${prompt}\n\n"${text}"`;

    let apiUrl = '';
    let requestBody = {};

    // 클라이언트에서 API 키에 접근하지 않고, 서버로 요청을 보냅니다.
    if (provider === 'openai') {
        // 서버 측 엔드포인트를 사용합니다.
        apiUrl = '/api/generate';

        requestBody = {
            chat_completion_source: 'openai', // OpenAI를 사용함을 명시합니다.
            model: model,
            messages: [{ role: 'user', content: fullPrompt }],
            stream: false, // 스트리밍이 필요 없으므로 false
            // 필요한 추가 설정이 있다면 여기에 추가합니다.
        };
    } else {
        // 다른 공급자들은 일단 그대로 둡니다.
        throw new Error('현재 OpenAI만 지원됩니다.');
    }

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(requestBody),
    });

    if (response.ok) {
        const result = await response.json();
        // OpenAI 응답 처리를 정확히 합니다.
        if (provider === 'openai') {
            return result.choices[0].message.content.trim();
        } else {
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
