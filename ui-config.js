const i18n = {
    ru: {
        pageTitle: "Spy game",
        msHeading: "Шпион", msSubtitle: "Вечеринковая игра на 4-10 игроков",
        msOnlineLabel: "Играть онлайн", msOnlineSub: "Общее лобби, роли раздаёт сервер",
        msOfflineLabel: "Играть офлайн", msOfflineSub: "Без интернета – у каждого своё устройство",
        backLabel: "Назад",
        labelGame: "Игра", helpGameMode: "Выбор игры меняет список карт/героев.",
        spyRole: "🕵️ Шпион", resultTitle: "Твоя роль:",
        offlineHeading: "Офлайн-режим",
        offlineSubtitle: "Договоритесь об общем коде и введите одинаковые значения.",
        labelSeed: "Общий код / seed", seedPlaceholder: "Например: 548129",
        helpSeed: "Все игроки вводят одинаковый код.",
        labelPlayers: "Количество игроков", helpPlayers: "Максимум 10.",
        labelPlayerIndex: "Твой номер игрока", helpPlayerIndex: "Уникальный номер от 1 до числа игроков.",
        showButton: "Показать мою роль",
        footerText: "⚠ Вводите коды аккуратно — все должны ввести одинаковые параметры.",
        errors: {
            noSeed: "Введите общий код.", playersMin: "Минимум 2 игрока.",
            playersMax: "Максимум 10 игроков.", badIndex: "Номер игрока от 1 до числа игроков.",
            cheat: "Играем честно! Выберите другой код если считаете это ошибкой."
        },
        onlineHeading: "Онлайн-режим",
        onlineSubtitle: "Создайте лобби и поделитесь кодом с друзьями.",
        labelNick: "Никнейм", nickPlaceholder: "Твой ник",
        createLobbyBtn: "Создать лобби",
        joinLobbyLabel: "Код лобби", joinLobbyPlaceholder: "Например: ABC123",
        joinLobbyBtn: "Войти по коду",
        leaveLobbyBtn: "Выйти",
        startRoundBtn: "🎮 Начать раунд",
        nextRoundBtn: "🔄 Следующий раунд",
        lobbyWord: "Лобби", inGame: "В игре",
        serverWaking: "Сервер просыпается, подожди ~30 сек...",
        serverOnline: "● Сервер онлайн", serverOffline: "● Сервер недоступен", serverConnecting: "○ Подключение...",
        chatHeader: "💬 Чат лобби", chatPlaceholder: "Сообщение...",
        actionsHeader: "⚡ Действия", playersHeader: "Игроки", settingsHeader: "Настройки",
        sgTitle: "🕵️ Угадать карту (1 попытка)",
        sgPlaceholder: "Введи название...", sgConfirm: "✓ Подтвердить угадывание",
        sgNoResults: "Ничего не найдено", sgHint: "Найди и выбери карту из списка",
        vkTitle: "🗳️ Голосование за изгнание",
        startVoteBtn: "⚡ Начать голосование",
        skipVote: "Пропустить",
        fvTitle: "🏁 Завершить матч",
        startFinishVote: "Предложить завершение",
        finishYes: "✓ Да, завершить",
        finishNo: "✗ Продолжить",
        voteInProgress: "Идёт голосование...",
        voted: (n,t) => `Проголосовало ${n}/${t}`,
        finishVoted: (n,t) => `Проголосовало ${n}/${t}`,
        timerLeft: (s) => `⏱ ${s}с`,
        tagYou: 'ты', tagKicked: 'изгнан', tagWinner: '🏆 угадал', tagGuessedWrong: '❌ не угадал',
        copyCode: "Скопировано!",
        sgConfirmDialog: (name) => `Угадать: "${name}"? Это ваша единственная попытка!`,
        sgConfirmBtn: '✓ Подтвердить',
        sgGuessCorrect: (name) => `угадал: ${name}!`,
        sgGuessWrong: (name) => `Не угадал. Правильно: ${name}`,
        kickedNotice: (nick) => `Ты изгнан голосованием. Наблюдай за игрой.`,
        grClose: "Закрыть",
        spyText(modeTitle, label) { return `Ты шпион в ${modeTitle}. Ты НЕ знаешь какой ${label} выпал. Слушай подсказки и не спались.`; },
        nonSpyText(modeTitle, label, itemName) { return `Тебе выпал ${label}: "${itemName}". Описывай так чтобы шпиону было сложно угадать.`; }
    },
    en: {
        pageTitle: "finkizet game",
        msHeading: "Spy", msSubtitle: "Party game for 4–10 players",
        msOnlineLabel: "Play online", msOnlineSub: "Shared lobby, server assigns roles",
        msOfflineLabel: "Play offline", msOfflineSub: "No internet needed",
        backLabel: "Back",
        labelGame: "Game", helpGameMode: "Changes the card/hero list.",
        spyRole: "🕵️ Spy", resultTitle: "Your role:",
        offlineHeading: "Offline mode",
        offlineSubtitle: "Agree on a shared code and enter the same values.",
        labelSeed: "Shared code / seed", seedPlaceholder: "E.g. 548129",
        helpSeed: "All players must enter the same code.",
        labelPlayers: "Number of players", helpPlayers: "Maximum 10.",
        labelPlayerIndex: "Your player number", helpPlayerIndex: "Unique number from 1 to player count.",
        showButton: "Show my role",
        footerText: "⚠ Enter codes carefully — everyone must use the same.",
        errors: {
            noSeed: "Enter the shared code.", playersMin: "At least 2 players.",
            playersMax: "Maximum 10 players.", badIndex: "Player number must be between 1 and total count.",
            cheat: "Play fair! Choose another code if you think this is a mistake."
        },
        onlineHeading: "Online mode",
        onlineSubtitle: "Create a lobby and share the code with friends.",
        labelNick: "Nickname", nickPlaceholder: "Your nick",
        createLobbyBtn: "Create lobby",
        joinLobbyLabel: "Lobby code", joinLobbyPlaceholder: "E.g. ABC123",
        joinLobbyBtn: "Join by code",
        leaveLobbyBtn: "Leave",
        startRoundBtn: "🎮 Start round",
        nextRoundBtn: "🔄 Next round",
        lobbyWord: "Lobby", inGame: "In game",
        serverWaking: "Server is waking up, please wait ~30 sec...",
        serverOnline: "● Server online", serverOffline: "● Server offline", serverConnecting: "○ Connecting...",
        chatHeader: "💬 Lobby chat", chatPlaceholder: "Message...",
        actionsHeader: "⚡ Actions", playersHeader: "Players", settingsHeader: "Settings",
        sgTitle: "🕵️ Guess the card (1 attempt)",
        sgPlaceholder: "Type a name...", sgConfirm: "✓ Confirm guess",
        sgNoResults: "Nothing found", sgHint: "Find and select a card",
        vkTitle: "🗳️ Vote to kick",
        startVoteBtn: "⚡ Start vote",
        skipVote: "Skip",
        fvTitle: "🏁 Finish match",
        startFinishVote: "Propose ending",
        finishYes: "✓ Yes, finish",
        finishNo: "✗ Continue",
        voteInProgress: "Vote in progress...",
        voted: (n,t) => `Voted ${n}/${t}`,
        finishVoted: (n,t) => `Voted ${n}/${t}`,
        timerLeft: (s) => `⏱ ${s}s`,
        tagYou: 'you', tagKicked: 'out', tagWinner: '🏆 won', tagGuessedWrong: '❌ wrong guess',
        copyCode: "Copied!",
        sgConfirmDialog: (name) => `Guess: "${name}"? This is your only attempt!`,
        sgConfirmBtn: '✓ Confirm',
        sgGuessCorrect: (name) => `guessed it: ${name}!`,
        sgGuessWrong: (name) => `Wrong guess. Correct: ${name}`,
        kickedNotice: (nick) => `You've been voted out. Watch the game.`,
        grClose: "Close",
        spyText(modeTitle, label) { return `You are the spy in ${modeTitle}. You do NOT know which ${label} everyone got. Listen and don't get caught.`; },
        nonSpyText(modeTitle, label, itemName) { return `You got a ${label}: "${itemName}". Describe it so the spy can't guess.`; }
    }
};

const uiElements = {
    // top bar / navigation
    langSelect:      document.getElementById('langSelectTop'),
    modeScreen:      document.getElementById('modeScreen'),
    onlineScreen:    document.getElementById('onlineScreen'),
    offlineScreen:   document.getElementById('offlineScreen'),
    lobbyGameScreen: document.getElementById('lobbyGameScreen'),
    btnOnline:       document.getElementById('btnOnline'),
    btnOffline:      document.getElementById('btnOffline'),
    backBtn:         document.getElementById('backBtn'),
    backFromOffline: document.getElementById('backFromOffline'),

    // online join/create
    nickInput:          document.getElementById('nickInput'),
    gameModeOnline:      document.getElementById('gameModeOnline'),
    helpGameModeOnline:  document.getElementById('helpGameModeOnline'),
    labelGameOnline:     document.getElementById('labelGameOnline'),
    createLobbyBtn:      document.getElementById('createLobbyBtn'),
    joinLobbyInput:      document.getElementById('joinLobbyInput'),
    joinLobbyBtn:        document.getElementById('joinLobbyBtn'),
    errorBoxOnline:      document.getElementById('errorBoxOnline'),
    serverStatusEl:      document.getElementById('serverStatus'),
    serverStatusTimer:   document.getElementById('serverStatusTimer'),

    // lobby game
    lgLobbyCode:    document.getElementById('lgLobbyCode'),
    lgStatus:       document.getElementById('lgStatus'),
    lgLeaveBtn:     document.getElementById('lgLeaveBtn'),
    lgGameSelect:   document.getElementById('lgGameSelect'),
    lgStartBtn:     document.getElementById('lgStartBtn'),
    lgNextRoundBtn: document.getElementById('lgNextRoundBtn'),
    lgPlayers:      document.getElementById('lgPlayers'),
    centerError:    document.getElementById('centerError'),
    roleCard:       document.getElementById('roleCard'),
    rcLabel:        document.getElementById('rcLabel'),
    rcRole:         document.getElementById('rcRole'),
    rcDesc:         document.getElementById('rcDesc'),

    // chat
    chatMessages: document.getElementById('chatMessages'),
    chatInput:    document.getElementById('chatInput'),
    chatSendBtn:  document.getElementById('chatSendBtn'),

    // spy guess
    spyGuessPanel:      document.getElementById('spyGuessPanel'),
    spyGuessInput:      document.getElementById('spyGuessInput'),
    spyGuessList:       document.getElementById('spyGuessList'),
    spyGuessConfirmBtn: document.getElementById('spyGuessConfirmBtn'),
    spyGuessResult:     document.getElementById('spyGuessResult'),

    // vote kick
    voteKickPanel:    document.getElementById('voteKickPanel'),
    voteProgress:     document.getElementById('voteProgress'),
    voteTimerEl:      document.getElementById('voteTimer'),
    voteTimerBar:     document.getElementById('voteTimerBar'),
    voteTimerBarFill: document.getElementById('voteTimerBarFill'),
    votePlayersList:  document.getElementById('votePlayersList'),
    startVoteBtn:     document.getElementById('startVoteBtn'),

    // finish vote
    finishVotePanel:    document.getElementById('finishVotePanel'),
    finishVoteProgress: document.getElementById('finishVoteProgress'),
    finishVoteTimerEl:  document.getElementById('finishVoteTimer'),
    finishVoteButtons:  document.getElementById('finishVoteButtons'),
    finishYesBtn:       document.getElementById('finishYesBtn'),
    finishNoBtn:        document.getElementById('finishNoBtn'),
    startFinishVoteBtn: document.getElementById('startFinishVoteBtn'),

    // result overlay
    gameResultOverlay: document.getElementById('gameResultOverlay'),
    grIcon:      document.getElementById('grIcon'),
    grTitle:     document.getElementById('grTitle'),
    grDesc:      document.getElementById('grDesc'),
    grSpyReveal: document.getElementById('grSpyReveal'),
    grCloseBtn:  document.getElementById('grCloseBtn'),

    // offline
    gameModeOffline:  document.getElementById('gameModeOffline'),
    seedInput:        document.getElementById('seedInput'),
    playersInput:     document.getElementById('playersInput'),
    playerIndexInput: document.getElementById('playerIndexInput'),
    showRoleBtn:      document.getElementById('showRoleBtn'),
    resultOffline:    document.getElementById('resultOffline'),
    roleTextOffline:  document.getElementById('roleTextOffline'),
    extraTextOffline: document.getElementById('extraTextOffline'),
    errorBoxOffline:  document.getElementById('errorBoxOffline'),
    footerTextEl:     document.getElementById('footerText')
};

function resolveI18nKey(lang, key) {
    const dict = i18n[lang];
    if (!dict) return undefined;
    return key.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), dict);
}

function updateUI(lang) {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const value = resolveI18nKey(lang, key);
        if (value === undefined) return; // ключа нет — оставляем заглушку из HTML
        if (typeof value !== 'string') return; // функции/объекты (voted(), errors{}) сюда не подходят

        const attr = el.getAttribute('data-i18n-attr'); // напр. data-i18n-attr="placeholder"
        if (attr) el.setAttribute(attr, value);
        else el.textContent = value;
    });
}
