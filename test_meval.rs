use meval::Context;

fn main() {
    let expr = "(sqrt(12544) * sin(pi/6) + 2^12 - 7^3) / (log(1000) * (cos(pi/3) + tan(pi/4)))";
    let mut ctx = Context::new(); // built-ins
    ctx.func("log", |x| x.log10());
    ctx.func("log10", |x| x.log10());
    ctx.func("log2", |x| x.log2());
    ctx.func("ln", |x| x.ln());
    
    // Add some physical constants
    ctx.var("c", 299792458.0);
    ctx.var("G", 6.67430e-11);
    
    let result = meval::eval_str_with_context(expr, ctx);
    match result {
        Ok(v) => println!("Success: {}", v),
        Err(e) => println!("Error: {}", e),
    }
}
