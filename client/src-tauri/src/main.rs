// 发布版不显示控制台窗口
// GUI 子系统：debug 构建也不弹控制台窗口（要看日志时用终端把本程序跑起来，stderr 照常输出）
#![windows_subsystem = "windows"]

fn main() {
    airhand_lib::run();
}
