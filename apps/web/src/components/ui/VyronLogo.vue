<script setup>
// The Vyron mark (@vyron/shared/logo): a solid V with a triangular "D" inside, with subtle shadows.
// Its colour is the theme's brand colour (--brand), so the logo changes with the design.
import { logoSvg } from '@vyron/shared/logo'
defineProps({ size: { type: Number, default: 28 } })
const svg = logoSvg('var(--brand)', { fx: true })
</script>

<template>
  <span class="vl" :style="{ '--s': size + 'px' }" aria-hidden="true" v-html="svg"></span>
</template>

<style scoped>
.vl{display:block;flex:none;width:var(--s);height:var(--s)}
</style>
