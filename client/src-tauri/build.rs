fn main() {
    // Media Foundation 延迟加载：Windows N/KN 版（未装媒体功能包）没有 mfplat.dll，
    // 延迟加载后程序仍能启动，并自动回退到软件编码。
    let target = std::env::var("TARGET").unwrap_or_default();
    if target.contains("windows-msvc") {
        println!("cargo:rustc-link-arg=/DELAYLOAD:mfplat.dll");
        println!("cargo:rustc-link-lib=delayimp");
    }
    tauri_build::build();

    // 测试（cargo test --lib 的单元测试、tests/ 里的测试）和示例（cargo run --example）的可执行文件
    // 也要有 manifest：tauri-build 只给 bin 目标嵌资源，而它们链接的是同一批依赖，
    // 会用到 comctl32 v6 的入口点（托盘、任务对话框、拖拽……）。没有 manifest 时加载器把
    // comctl32 绑到 5.82，进程一加载就报 STATUS_ENTRYPOINT_NOT_FOUND（0xC0000139）。
    // 资源本身见 windows/tests.rc（只有 Common-Controls v6 一个依赖）。
    //
    // 必须放在 tauri_build::build() 之后：rustc 按打印顺序把对象交给链接器，bin 上 tauri 的
    // 资源树（图标、版本信息、它自己的 manifest）在前，加载器读到的就是它；这里多出来的一份
    // 排在后面，是 bin 用不到的冗余数据。测试和示例上没有 tauri 的资源，只有这一份 manifest。
    //
    // 只在 GNU 工具链下做：MSVC 的 link.exe 遇到重复的 manifest 资源会直接报错（CVT1100），
    // 不能这样叠加。
    if std::env::var("TARGET").unwrap_or_default().contains("windows-gnu") {
        embed_resource::compile_for_everything("windows/tests.rc", embed_resource::NONE)
            .manifest_required()
            .unwrap();
        println!("cargo:rerun-if-changed=windows/tests.rc");
        println!("cargo:rerun-if-changed=windows/tests.manifest.xml");
    }
}
