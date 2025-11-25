# ComfyUI-Nitra

A comprehensive ComfyUI extension that provides authentication, model management, workflow installation, and environment updates through an integrated interface.

## Installation

### Requirements
- ComfyUI installation
- Python 3.8 or higher
- Git

### Steps

1. **Clone the repository into your ComfyUI custom_nodes directory:**

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/TheArtOfficial/ComfyUI-Nitra.git
```

2. **Install dependencies:**

```bash
cd ComfyUI-Nitra
pip install -r requirements.txt
```

3. **Restart ComfyUI**

After restarting, you'll see a pink **"nitra"** button in the top menu bar.

## Getting Started

### First Time Setup

1. Click the **"nitra"** button in the top menu bar
2. You'll be prompted to authenticate. Choose one of the following methods:
   - **Username/Password**: Enter your credentials and click "Login"
   - **Google OAuth**: Click "Login with Google"
   - **GitHub OAuth**: Click "Login with GitHub"

Once authenticated, you'll have access to all nitra features.

## Features & Usage

### Optimizer Tab

The Optimizer tab provides options to update and maintain your ComfyUI installation.

#### Updating ComfyUI

1. Select your update preferences:
   - **Update ComfyUI**: Updates the core ComfyUI installation
   - **Update Nitra**: Updates the Nitra extension itself
   - **Update Custom Nodes**: Updates all custom nodes
   - **Update Python Packages**: Updates Python dependencies

2. Configure Torch/CUDA settings (optional):
   - Select your desired **Torch Version**
   - Select your **CUDA Version** (if using NVIDIA GPU)

3. Click **"Start Update"** to begin

The update will run in the background, allowing you to continue using ComfyUI. You'll receive a notification when it's complete.

### Models Tab

Download and manage AI models directly from the Nitra interface.

#### Downloading Models

1. Navigate to the **"Models"** tab
2. Browse the available models in the list
3. Click the checkbox next to models you want to download
4. Click **"Download Selected Models"**

Models will download in the background. You can continue working while they download.

#### HuggingFace Token (Optional)

Some models require authentication:
1. Enter your HuggingFace token in the field at the top
2. The token will be used for all model downloads that require it

### Workflows Tab

Install pre-configured ComfyUI workflows.

#### Installing Workflows

1. Navigate to the **"Workflows"** tab
2. Browse available workflows
3. Select the workflows you want to install
4. Click **"Download Selected Workflows"**

Workflows are installed automatically and will appear in your ComfyUI workflows directory.

### User Configuration Tab

Configure custom settings for your ComfyUI installation.

#### Setting Up Extra Model Paths

If you store models in a separate directory:

1. Navigate to the **"User Configuration"** tab
2. In the **"Extra Model Path"** field, enter the absolute path to your models directory
   - Windows example: `D:\Models`
   - Linux/Mac example: `/mnt/models` or `/Users/username/Models`
3. Click **"Save Settings"**

This automatically creates an `extra_model_paths.yaml` file in your ComfyUI root directory, pointing to your custom model location.

**To remove the extra path:**
1. Clear the text field
2. Click **"Save Settings"**
3. The `extra_model_paths.yaml` file will be automatically deleted

#### HuggingFace Token Storage

Save your HuggingFace token for persistent use:

1. Enter your token in the **"Huggingface Token (Stored Locally Only)"** field
2. Click **"Save Settings"**

Your token will be securely stored and automatically used for model downloads.

### Help Tab

Get support and submit inquiries.

#### Reporting Issues

Found a bug or technical issue?
- Click **"Report Issues on GitHub"** to open the issues page
- This takes you directly to the GitHub repository where you can submit bug reports

#### Business Inquiries

For business-related questions, partnerships, or general inquiries:

1. Navigate to the **"How can we help?"** tab
2. Fill out the contact form:
   - **Name** (required)
   - **Email** (required)
   - **Phone** (optional)
   - **Country Code** (if providing phone)
   - **Company** (optional)
   - **Message** (required)
3. Optionally, check **"Subscribe to newsletter"** for updates
4. Click **"Send Message"**

**Note:** For technical issues and bugs, please use GitHub Issues instead of the contact form.

## Keyboard Shortcut

You can open the Nitra dialog at any time using:
- **Windows/Linux**: `Ctrl + L`
- **Mac**: `Cmd + L`

## License & Subscription

Your subscription status is displayed at the top of the interface after logging in. Different subscription tiers may have access to different features and models.

To manage your subscription, visit [nitralabs.ai](https://nitralabs.ai).

## Troubleshooting

### Button Not Appearing
If the nitra button doesn't appear after installation:
1. Verify the extension is in `ComfyUI/custom_nodes/ComfyUI-Nitra`
2. Check that all dependencies are installed: `pip install -r requirements.txt`
3. Restart ComfyUI completely
4. Check the browser console (F12) for any error messages

### Authentication Issues
If you're having trouble logging in:
1. Clear your browser cache and cookies for the ComfyUI page
2. Try a different authentication method (OAuth instead of password, or vice versa)
3. Check that you're using the correct credentials

### Model Download Failures
If models fail to download:
1. Check your internet connection
2. Verify you have sufficient disk space
3. For gated models, ensure your HuggingFace token is valid and has access
4. Check the ComfyUI console for detailed error messages

### Update Failures
If updates fail:
1. Ensure you have write permissions to the ComfyUI directory
2. Check that no ComfyUI processes are holding files
3. Review the logs in the ComfyUI console
4. Try updating components individually rather than all at once

## Support

- **Technical Issues**: [GitHub Issues](https://github.com/TheArtOfficial/ComfyUI-Nitra/issues)
- **Business Inquiries**: Use the contact form in the Help tab
- **Documentation**: This README

## Privacy & Security

- Authentication tokens are stored securely in your browser's local storage
- Your HuggingFace token is stored locally in `ComfyUI/user/default/nitra/config.toml`
- No sensitive data is transmitted to third parties beyond authentication providers (Google, GitHub)
- All communication with the Nitra backend uses HTTPS

## Updates

Nitra can update itself through the Optimizer tab. We recommend keeping the extension up to date for the latest features and security improvements.

---

**Developed by AO Labs** | [nitralabs.ai](https://nitralabs.ai)

