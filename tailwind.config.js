/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 覆盖 slate 调色板为 VS Code "Light Modern" 风格的中性灰阶。
        // 浅色系主要使用 slate-*，故此覆盖主要影响浅色主题。
        // 参考 VS Code Light Modern：编辑器 #FFFFFF / 侧栏面板 #F8F8F8 / 边框 #E5E5E5 / 文本 #3B3B3B。
        slate: {
          50: '#F8F8F8',   // 侧栏 / 面板 / 次级背景
          100: '#F3F3F3',  // 轻 hover 背景
          200: '#E8E8E8',  // 较深 hover / 表头 / 分隔
          300: '#E5E5E5',  // 边框
          400: '#CECECE',  // 输入框边框 / 次要图标 / placeholder
          500: '#8A8A8A',  // 次要文本
          600: '#616161',  // 常规次要文本
          700: '#3B3B3B',  // 主文本
          800: '#2B2B2B',  // 强调文本
          900: '#1F1F1F',  // 标题 / 最深文本
        },
        // 覆盖 zinc 调色板为 VS Code "Default Dark Modern" 风格的中性灰阶。
        // 暗色系主要使用 zinc-*，故此覆盖主要影响暗色主题。
        // 参考 VS Code Dark Modern：侧栏/面板 #181818 / 编辑器 #1F1F1F /
        //                         边框 #2B2B2B / widget #3C3C3C / 主文本 #CCCCCC / 次文本 #9D9D9D。
        zinc: {
          50:  '#F4F4F4',
          100: '#E5E5E5',
          200: '#D4D4D4',
          300: '#CCCCCC',  // VS Code foreground - 主文本
          400: '#9D9D9D',  // VS Code descriptionForeground - 次要文本
          500: '#858585',  // placeholder / disabled
          600: '#6C6C6C',  // 更次要的文本 / 图标
          700: '#3C3C3C',  // 输入框边框 / widget 边框
          800: '#2B2B2B',  // 分隔线 / 深 hover
          900: '#181818',  // 侧栏 / 顶栏 / 面板 / 状态栏 (VS Code Dark Modern base)
          950: '#141414',  // 更暗的窗口容器底色（区分层次）
        },
      },
    },
  },
  plugins: [],
}
