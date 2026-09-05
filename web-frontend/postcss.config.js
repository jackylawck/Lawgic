export default ({ env }) => {
  const isProd = env === 'production' || process.env.NODE_ENV === 'production';

  return {
    plugins: {
      'tailwindcss/nesting': {},
      tailwindcss: {},
      autoprefixer: {
        // 確保 flexbox 與 grid 在舊版瀏覽器或 iOS 舊版 Safari 上的前綴補齊
        flexbox: 'no-2009',
        grid: 'autoplace',
      },
      ...(isProd
        ? {
            cssnano: {
              preset: [
                'advanced',
                {
                  discardComments: { removeAll: true },
                  reduceIdents: false, // 避免破壞 keyframe 動畫名稱
                  zindex: false,       // 避免重寫全域彈窗與棋盤圖層的 z-index
                },
              ],
            },
          }
        : {}),
    },
  };
};
