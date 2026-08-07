// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
    build: {
        format: 'file', // 打包成单个文件
    },
    trailingSlash: 'never',
});
