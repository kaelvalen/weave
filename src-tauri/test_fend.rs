fn main() {
    let mut ctx = fend_core::Context::new();
    match fend_core::evaluate("(sqrt(12544) * sin(pi/6) + 2^12 - 7^3) / (log(1000) * (cos(pi/3) + tan(pi/4)))", &mut ctx) {
        Ok(result) => println!("Success: {}", result.get_main_result()),
        Err(e) => println!("Error: {}", e),
    }
}
