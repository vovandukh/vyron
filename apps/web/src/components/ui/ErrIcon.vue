<script setup>
// Icons for Klipper error categories (@vyron/shared/klipper/errors.js): line icons, 24×24, currentColor.
defineProps({ cat: { type: String, default: 'generic' }, size: { type: Number, default: 18 } })
</script>

<template>
  <svg class="ei" :width="size" :height="size" viewBox="0 0 24 24" aria-hidden="true">
    <!-- MCU: a chip with pins -->
    <template v-if="cat === 'mcu'"><rect x="6.5" y="6.5" width="11" height="11" rx="2" /><path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21" /><path d="M10 12h4" /></template>
    <!-- Heat: thermometer -->
    <template v-else-if="cat === 'heat'"><path d="M10 4.5a2 2 0 0 1 4 0v9.2a4 4 0 1 1-4 0Z" /><path d="M12 10v6" /><circle cx="12" cy="17" r="1.3" class="f" /></template>
    <!-- Configuration: a document with sliders -->
    <template v-else-if="cat === 'config'"><path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20Z" /><path d="M14 3.5V8h4" /><path d="M9.5 12.5h5M9.5 16h3.5" /></template>
    <!-- Motion: a cross of arrows -->
    <template v-else-if="cat === 'motion'"><path d="M12 3v18M3 12h18M12 3 9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5" /></template>
    <!-- Sensor / probe: a probe over the bed -->
    <template v-else-if="cat === 'probe'"><path d="M9 3.5h6v6l-3 4-3-4Z" /><path d="M12 13.5v3" /><path d="M4 20h16" /><path d="M7 17.5h10" class="d" /></template>
    <!-- Driver: a chip with a lightning bolt -->
    <template v-else-if="cat === 'driver'"><rect x="4" y="6" width="16" height="12" rx="2.5" /><path d="m12.8 8.5-2.6 4h3.6l-2.6 4" /></template>
    <!-- Emergency stop: an octagon -->
    <template v-else-if="cat === 'estop'"><path d="M8.3 3.5h7.4l4.8 4.8v7.4l-4.8 4.8H8.3l-4.8-4.8V8.3Z" /><path d="M8.5 12h7" /></template>
    <!-- Macro: curly braces -->
    <template v-else-if="cat === 'macro'"><path d="M9 4.5c-2 0-2.5 1-2.5 2.5v2c0 1.5-.8 2.5-2.5 3 1.7.5 2.5 1.5 2.5 3v2c0 1.5.5 2.5 2.5 2.5M15 4.5c2 0 2.5 1 2.5 2.5v2c0 1.5.8 2.5 2.5 3-1.7.5-2.5 1.5-2.5 3v2c0 1.5-.5 2.5-2.5 2.5" /></template>
    <!-- Host / service: a server -->
    <template v-else-if="cat === 'host'"><rect x="4" y="4.5" width="16" height="6" rx="1.8" /><rect x="4" y="13.5" width="16" height="6" rx="1.8" /><circle cx="7.5" cy="7.5" r="1" class="f" /><circle cx="7.5" cy="16.5" r="1" class="f" /></template>
    <!-- Other: a triangle with an exclamation mark -->
    <template v-else><path d="M10.3 4.6a2 2 0 0 1 3.4 0l7.1 12.3a2 2 0 0 1-1.7 3H4.9a2 2 0 0 1-1.7-3Z" /><path d="M12 9.5v4.2" /><circle cx="12" cy="16.8" r="1.1" class="f" /></template>
  </svg>
</template>

<style scoped>
.ei{flex:none;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.ei .f{fill:currentColor;stroke:none}
.ei .d{stroke-dasharray:1.5 2.5;opacity:.6}
</style>
