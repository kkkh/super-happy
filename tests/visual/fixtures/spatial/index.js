Page({
  data: {
    themeClass: 'theme-light',
    aurora: true,
    showDecor: true,
    caseId: '01-light-aurora-decor',
    amount: 328650.5,
  },

  onLoad() {
    this.applyCase({
      id: '01-light-aurora-decor',
      theme: 'light',
      aurora: true,
      decor: true,
    })
  },

  applyCase(input) {
    const config = input || {}
    const themeClass = config.theme === 'dark' ? 'theme-dark' : 'theme-light'

    this.setData({
      themeClass,
      aurora: config.aurora !== false,
      showDecor: config.decor !== false,
      caseId: config.id || '',
    })
  },

  onToggleTheme() {
    this.setData({
      themeClass:
        this.data.themeClass === 'theme-dark' ? 'theme-light' : 'theme-dark',
    })
  },
})
