#!/usr/bin/env python3
"""把纯黑背景图片或视频转换为带 Alpha 的 PNG/WebM。需要 ffmpeg。"""
import argparse, shutil, subprocess
from pathlib import Path

def main():
    p = argparse.ArgumentParser(description="黑底素材转透明背景")
    p.add_argument("input", help="黑底图片或视频")
    p.add_argument("output", help="输出 .png 或 .webm")
    p.add_argument("--similarity", type=float, default=0.015, help="黑色容差，默认 0.015，优先保护深色主体")
    p.add_argument("--blend", type=float, default=0.012, help="边缘柔化，默认 0.012")
    p.add_argument("--alpha-cutoff", type=int, default=32, help="清零低 Alpha 背景，消除浅灰方框；范围 0-255，默认 32")
    p.add_argument("--crf", type=int, default=28, help="WebM 质量，越低越清晰")
    a = p.parse_args()
    if not shutil.which("ffmpeg"): raise SystemExit("未找到 ffmpeg")
    src, out = Path(a.input).resolve(), Path(a.output).resolve()
    if not src.is_file(): raise SystemExit(f"输入不存在：{src}")
    out.parent.mkdir(parents=True, exist_ok=True)
    cutoff = max(0, min(255, a.alpha_cutoff))
    vf = f"colorkey=0x000000:{a.similarity}:{a.blend},format=rgba,lut=a='if(lt(val\\,{cutoff})\\,0\\,val)',format=yuva420p"
    cmd = ["ffmpeg", "-y", "-i", str(src), "-vf", vf]
    if out.suffix.lower() == ".webm": cmd += ["-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-crf", str(a.crf), "-b:v", "0"]
    elif out.suffix.lower() == ".png": cmd += ["-frames:v", "1", "-pix_fmt", "rgba"]
    else: raise SystemExit("输出只支持 .png 或 .webm")
    subprocess.run(cmd + [str(out)], check=True)
    print(out)
if __name__ == "__main__": main()
