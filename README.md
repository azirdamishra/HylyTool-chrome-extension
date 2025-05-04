# HylyTool Chrome Extension

A versatile Chrome extension for enhancing your web browsing experience with text highlighting and blurring capabilities.

![MIT License](https://img.shields.io/badge/License-MIT-green.svg)
![Version](https://img.shields.io/badge/version-0.1.0-blue)

## Features

HylyTool offers two main functionalities to improve your online reading and privacy:

### 🖍️ Text Highlighting

- Highlight important text on any webpage
- Choose from a variety of colors
- Highlights persist across page reloads
- Easily manage your highlights

### 🔍 Text Blurring

- Blur sensitive or triggering content
- Simply enter the text you want to blur
- Works dynamically without page reload
- Improves focus by removing distractions

## Installation

### From Source

1. Clone the repository:
   ```bash
   git clone https://github.com/azirdamishra/HylyTool-chrome-extension.git
   cd HylyTool-chrome-extension
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Load the extension in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" in the top right corner
   - Click "Load unpacked" and select the `dist` directory from the project

### Development Mode

For active development with hot reloading:

```bash
npm start
```

## Usage

### Highlighting Text

1. Enable the extension using the toggle switch
2. Enable highlight mode
3. Select a highlight color
4. Select text on any webpage to highlight it
5. Highlights will persist across page reloads

### Blurring Text

1. Enable the extension using the toggle switch
2. Enter the text you want to blur in the "Text to blur" field
3. Click "Apply Blur" button
4. All instances of the specified text will be blurred on the current webpage
5. Use "Remove Blur" to clear all blur effects

## Project Structure

```
HylyTool/
├── src/                 # Source code
│   ├── background.ts    # Service worker script
│   ├── content.ts       # Content script for webpage interaction
│   ├── popup.ts         # Popup UI functionality
│   └── common.ts        # Shared utilities and functions
├── static/              # Static assets
│   ├── manifest.json    # Extension manifest
│   ├── popup.html       # Popup UI structure
│   └── popup.css        # Popup styling
└── webpack.*.ts         # Build configuration
```

## Technical Details

HylyTool is built with:

- TypeScript for type-safe code
- Modern JavaScript features
- Webpack for bundling
- ESLint and Prettier for code quality

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Author

Developed by [azirdamishra](https://github.com/azirdamishra)
