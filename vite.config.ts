import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const backendTarget = process.env.VITE_BACKEND_TARGET ?? 'http://127.0.0.1:3334'
const backendOrigin = new URL(backendTarget).origin
const proxy = {
    '/api': {
        target: backendTarget,
        changeOrigin: true,
        configure(proxy) {
            proxy.on('proxyReq', (proxyReq, req) => {
                if (req.headers.origin) {
                    proxyReq.setHeader('origin', backendOrigin)
                }
            })
        }
    },
    '/mcp': {
        target: backendTarget,
        changeOrigin: true,
        configure(proxy) {
            proxy.on('proxyReq', (proxyReq, req) => {
                if (req.headers.origin) {
                    proxyReq.setHeader('origin', backendOrigin)
                }
            })
        }
    }
}

export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
            manifest: {
                name: 'Startup Idea Tracker',
                short_name: 'IdeaTracker',
                description: 'Track and Analyze your Startup Ideas offline.',
                theme_color: '#ffffff',
                icons: [
                    {
                        src: 'pwa-192x192.png',
                        sizes: '192x192',
                        type: 'image/png'
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png'
                    }
                ]
            }
        })
    ],
    server: {
        host: '127.0.0.1',
        port: 5173,
        strictPort: true,
        proxy
    },
    preview: {
        host: '127.0.0.1',
        port: 4173,
        strictPort: true,
        proxy
    }
})
