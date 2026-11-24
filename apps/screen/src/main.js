import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { logoDataUri } from '@vyron/shared/logo'
import App from './App.vue'
import '@vyron/shared/fonts.css'
import './styles.css'
import { installDragScroll } from './dragScroll'

// Touch vs scroll: on resistive touch Chromium often sees a "mouse" — we scroll ourselves
installDragScroll()

const icon = Object.assign(document.createElement('link'), { rel: 'icon', type: 'image/svg+xml', href: logoDataUri() })
document.head.appendChild(icon)

createApp(App).use(createPinia()).mount('#app')
