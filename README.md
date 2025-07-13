# messa - Защищённый мессенджер нового поколения

## Особенности

- **Квантово-устойчивая криптография**: Kyber-768, Dilithium-3
- **Полная децентрализация**: P2P через libp2p, DHT, Tor/I2P
- **Биометрическая аутентификация**: Вход только по фото лица
- **Встроенные кошельки**: BTC, Monero, Zcash
- **Zero-Knowledge доказательства**: Максимальная приватность
- **Локальная база данных**: Зашифрованная PostgreSQL в приложении

## Платформы

- iOS/Android (React Native + Expo)
- macOS/Windows/Linux (Electron)
- Web (Next.js PWA)

## Архитектура

```
messa/
├── apps/
│   ├── mobile/          # React Native приложение
│   ├── desktop/         # Electron приложение
│   └── web/            # Next.js PWA
├── modules/
│   ├── auth-biometry/   # Биометрическая аутентификация
│   ├── messaging-core/  # Signal Protocol, MLS
│   ├── crypto-layer/    # Квантовая криптография
│   ├── call-p2p/       # WebRTC звонки
│   ├── p2p-network/    # libp2p, DHT, Tor/I2P
│   ├── wallet-core/    # Криптокошельки
│   ├── local-db/       # Локальная БД
│   ├── analytics-premium/ # Премиум функции
│   └── zk-privacy/     # Zero-Knowledge
├── shared/
│   ├── ui-kit/         # UI компоненты
│   └── lib/            # Общие утилиты
└── scripts/            # Скрипты сборки
```

## Быстрый старт

### Требования

- Node.js 18+
- pnpm 8+
- Xcode (для iOS)
- Android Studio (для Android)

### Установка

```bash
# Клонировать репозиторий
git clone https://github.com/yourusername/messa.git
cd messa

# Установить зависимости
pnpm install

# Запустить в режиме разработки
pnpm dev
```

### Разработка

```bash
# Мобильное приложение
pnpm dev:mobile

# Десктоп приложение
pnpm dev:desktop

# Веб приложение
pnpm dev:web
```

### Сборка

```bash
# Все платформы
pnpm build

# Конкретная платформа
pnpm build:mobile
pnpm build:desktop
pnpm build:web
```

## Монетизация

### Free
- Базовый мессенджер
- Каналы до 1000 подписчиков
- P2P звонки
- Базовые функции кошелька

### Premium
- Автобэкап ключей (локально)
- Мультиаккаунты через биометрию
- Расширенные темы
- Invite-only каналы
- Аналитика каналов
- Привязка нескольких устройств
- Откат ключей через MPC

## Безопасность

- **E2E шифрование**: Signal Protocol для личных чатов
- **Групповое шифрование**: MLS (Messaging Layer Security)
- **Квантовая устойчивость**: Kyber + Dilithium
- **Анонимность**: zk-SNARKs для критичных операций
- **Локальное хранение**: Все данные только на устройстве
- **Zero Trust**: Никаких доверенных серверов

## 📖 Документация

Подробная документация по каждому модулю находится в соответствующих папках:

- [Биометрическая аутентификация](modules/auth-biometry/README.md)
- [Криптография](modules/crypto-layer/README.md)
- [P2P сеть](modules/p2p-network/README.md)
- [Кошельки](modules/wallet-core/README.md)

## Вклад в проект

Мы приветствуем вклад в развитие проекта! Пожалуйста, ознакомьтесь с [CONTRIBUTING.md](CONTRIBUTING.md) перед отправкой PR.

## Лицензия

messa распространяется под лицензией MIT. См. файл [LICENSE](LICENSE) для деталей.

## Дисклеймер

Это программное обеспечение предоставляется "как есть". Используйте на свой страх и риск. Разработчики не несут ответственности за любые последствия использования.
