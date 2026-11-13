# Proposal

## Why

Ядро синхронизации (`sync-core`) и арена машин (`vehicles-arena`) готовы, но не связаны с сетью. Разбор JSON и применение 15 000 сообщений в секунду не должны занимать основной поток: решение из config.yaml — WebSocket, JSON и ядро живут в Web Worker, а в основной поток уходят пакеты раз в кадр. Нужен и единый HTTP-клиент (правило 3).

## What Changes

- Общий HTTP-клиент `src/shared/http`: не бросает исключение на 4xx/5xx, различает сетевую ошибку и таймаут.
- Слой `sync/api`: загрузка снимка и открытие WebSocket с микропакетированием.
- `SyncEngine`: ядро + сеть + арена + пакеты; не зависит от `Worker` и запускается в Node.
- Протокол воркера и тонкая оболочка `sync.worker.ts`; клиент основного потока `SyncClient`.
- Пакеты в основной поток раз в 50 мс: кадр машин (transferable, пул буферов), справочники, сообщения о пунктах и решениях, статус связи; ограничение числа кадров в полёте.
- `connectionStore` (Pinia) и хранилище кадра машин вне Pinia; применение пакета через `applyBatch`.
- Проверка в Node против настоящей заглушки с `FAULTS=drop,dup,reorder` и `reset`: экран-зеркало сходится с состоянием сервера.

## Capabilities

### New Capabilities
- `sync-transport`: как данные доходят до экрана: воркер, пакеты, статус связи, обратное давление, единый HTTP-клиент.

### Modified Capabilities
<!-- Нет: realtime-sync описывает поведение ядра, оно не меняется. -->

## Impact

- `src/shared/http/`, `src/modules/sync/{api,engine,worker,client,store}`, `src/modules/vehicles/frameStore.ts`.
- Тесты в Node против `startMock` из `mock/`.

## Non-Goals

- Интерфейс и контейнеры экрана, команды, отрисовка.
