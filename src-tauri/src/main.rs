// Prevent a CMD window from appearing on Windows (both debug and release builds)
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    gif_picker_lib::run()
}
