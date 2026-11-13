<script setup lang="ts">
import NoticeStack from './NoticeStack.vue'
import { useNoticeStore } from './store/noticeStore'

const store = useNoticeStore()
</script>

<template>
  <NoticeStack :notices="store.notices" @dismiss="store.dismissNoticeMutator" />
</template>
