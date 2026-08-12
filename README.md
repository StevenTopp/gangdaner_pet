# 钢蛋儿桌面宠物

基于 Electron 的单动作桌面宠物。钢蛋儿会循环播放“玩毛线球”动作。

## 开发运行

```powershell
npm install
npm start
```

按住左键移动超过 5 像素后可拖动桌宠；单纯长按不会改变桌宠大小。右键可以让桌宠回到屏幕右下角或退出。

显示尺寸最小为 `88px`，快捷档位为 `100 / 200 / 300 / 420 / 680px`。

## 打包

```powershell
npm run dist:win
```

输出文件为 `dist/钢蛋儿桌面宠物.exe`。

## 黑底素材转透明

视频输出为透明 VP9 WebM：

```powershell
python scripts/black_background_to_alpha.py "黑底视频.webm" "app/08_可替换素材/新动作.webm"
```

图片输出为透明 PNG：

```powershell
python scripts/black_background_to_alpha.py "黑底图片.png" "app/08_可替换素材/新动作.png"
```

可用 `--similarity` 调整黑色容差、`--blend` 调整边缘柔化。默认采用兼顾黑色颗粒清理和深色毛发保留的 `0.035 / 0.010`；角色本身包含大面积纯黑色时应减小 `--similarity`。
