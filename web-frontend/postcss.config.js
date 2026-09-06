export default () => {
  return {
    plugins: {
      'tailwindcss/nesting': {},
      tailwindcss: {},
      autoprefixer: {
        // 確保 flexbox 與 grid 在舊版瀏覽器或 iOS 舊版 Safari 上的前綴補齊
        flexbox: 'no-2009',
        grid: 'autoplace',
      },
    },
  };
};
