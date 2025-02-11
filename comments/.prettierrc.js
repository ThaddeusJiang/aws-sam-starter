module.exports = {
  semi: true,
  trailingComma: 'es5',
  singleQuote: true,
  printWidth: 100,
  useTabs: true,
  tabWidth: 4,
  bracketSpacing: true,
  arrowParens: 'always',
  endOfLine: 'lf',
  overrides: [
    {
      files: '*.ts',
      options: {
        useTabs: true,
        tabWidth: 4
      }
    }
  ]
};
