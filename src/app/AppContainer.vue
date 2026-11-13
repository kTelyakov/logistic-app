<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { DecisionsContainer } from '@/modules/decisions'
import { PointsContainer } from '@/modules/points'
import { SiteMapContainer } from '@/modules/site-map'
import { fetchMe, useSessionStore } from '@/modules/session'
import { ConnectionContainer, createSyncClient, useConnectionStore, type SyncClient } from '@/modules/sync'
import { configureHttp } from '@/shared/http'
import { NoticeContainer } from '@/shared/notices'
import { resolveApiBase } from './apiBase'
import { createBatchTarget } from './batchTarget'
import { installTestHook } from './testHook'

const session = useSessionStore()
const connection = useConnectionStore()
const baseUrl = resolveApiBase(window.location.search)

const SESSION_RETRY_MS = 2_000
const sessionLoading = ref(true)
let client: SyncClient | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined
let alive = true

async function loadSession(): Promise<void> {
  try {
    session.setMeMutator(await fetchMe())
    sessionLoading.value = false
  } catch (error) {
    session.setErrorMutator(error instanceof Error ? error.message : String(error))
    if (alive) retryTimer = setTimeout(loadSession, SESSION_RETRY_MS)
  }
}

onMounted(() => {
  configureHttp({ baseUrl })
  installTestHook(() => connection.appliedSeq)
  void loadSession()
  client = createSyncClient({
    baseUrl,
    target: createBatchTarget(),
    onStatus: (status) => connection.applyStatusMutator(status, performance.now()),
  })
  client.start()
})

onBeforeUnmount(() => {
  alive = false
  if (retryTimer) clearTimeout(retryTimer)
  client?.stop()
})
</script>

<template>
  <div class="app" data-testid="app-root">
    <header class="topbar">
      <h1 class="topbar__title">Диспетчерская</h1>
      <span v-if="session.me" class="topbar__site" data-testid="site-name">{{ session.siteName }}</span>
      <span class="topbar__spacer" />
      <span v-if="session.me" class="topbar__user" data-testid="user">
        {{ session.me.name }}
        <small class="topbar__role" :class="{ 'topbar__role--observer': !session.mayCommand }" data-testid="role">
          {{ session.mayCommand ? 'диспетчер' : 'наблюдатель' }}
        </small>
      </span>
      <ConnectionContainer />
    </header>

    <p v-if="session.error && sessionLoading" class="banner banner--error" role="alert" data-testid="session-error">
      Не удалось загрузить данные пользователя: {{ session.error }}. Повторяем…
    </p>

    <NoticeContainer />

    <main class="layout">
      <SiteMapContainer />
      <aside class="side">
        <PointsContainer />
        <DecisionsContainer />
      </aside>
    </main>
  </div>
</template>
