<script setup>
// Engineering menu: one tab instead of Engineering + Config.
// A segmented control on top; the selected section lives in ui.engSection for the session.
// Both sections stay mounted (v-show) — unsaved config edits are never lost.
import { ref, computed, onActivated, onDeactivated } from 'vue'
import { useUiStore } from '../../stores/uiStore'
import { useI18n } from '../../composables/useI18n'
import SegmentedControl from '../ui/SegmentedControl.vue'
import EngineeringTab from './EngineeringTab.vue'
import ConfigTab from './ConfigTab.vue'

const ui = useUiStore()
const { t } = useI18n()

const sections = computed(() => [
  { value: 'sys', label: t('eng.secSys') },
  { value: 'cfg', label: t('eng.secCfg') }
])
const visible = ref(true)
onActivated(() => { visible.value = true })
onDeactivated(() => { visible.value = false })
</script>

<template>
  <section class="view">
    <SegmentedControl v-model="ui.engSection" :options="sections" :aria-label="t('nav.eng')" />
    <!-- Only the appearing section animates: the old one disappears instantly so they don't overlap -->
    <Transition name="sec">
      <EngineeringTab v-if="ui.engSection === 'sys'" :active="visible" />
    </Transition>
    <!-- Configuration is only hidden (v-show): the open file and edits survive switching -->
    <Transition name="sec">
      <ConfigTab v-show="ui.engSection === 'cfg'" />
    </Transition>
  </section>
</template>

<style scoped>
.sec-enter-active{transition:opacity var(--t-mid) var(--ease-out),transform var(--t-spring) var(--spring)}
.sec-enter-from{opacity:0;transform:translateY(6px)}
</style>
