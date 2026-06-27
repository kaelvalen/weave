use serde_json::{json, Value};
use tracing::info;

use crate::models::plugin::PluginExecutor;
use crate::utils::errors::WeaveError;

pub struct CalcPlugin;

impl PluginExecutor for CalcPlugin {
    fn execute(&self, capability: &str, params: Value) -> Result<Value, WeaveError> {
        match capability {
            "calc.eval" => Self::eval(params),
            "calc.convert" => Self::convert(params),
            "calc.stats" => Self::stats(params),
            _ => Err(WeaveError::CapabilityNotFound(capability.to_string())),
        }
    }
}

impl CalcPlugin {
    pub fn execute(capability: &str, params: Value) -> Result<Value, WeaveError> {
        match capability {
            "calc.eval" => Self::eval(params),
            "calc.convert" => Self::convert(params),
            "calc.stats" => Self::stats(params),
            _ => Err(WeaveError::CapabilityNotFound(capability.to_string())),
        }
    }

    fn eval(params: Value) -> Result<Value, WeaveError> {
        let expression = params.get("expression")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'expression' parameter".to_string()))?;
        
        let result = Self::evaluate_expression(expression)?;
        
        info!("Calculated: {} = {}", expression, result);
        
        Ok(json!({
            "expression": expression,
            "result": result,
            "formatted": Self::format_number(result),
            "success": true
        }))
    }

    fn convert(params: Value) -> Result<Value, WeaveError> {
        let value = params.get("value")
            .and_then(|v| v.as_f64())
            .ok_or_else(|| WeaveError::PluginError("Missing or invalid 'value' parameter".to_string()))?;
        
        let from_unit = params.get("from")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'from' parameter".to_string()))?;
        
        let to_unit = params.get("to")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'to' parameter".to_string()))?;
        
        let from_lower = from_unit.to_lowercase();
        let to_lower = to_unit.to_lowercase();

        // Check if this is a temperature conversion first
        let is_temp_from = Self::is_temperature_unit(&from_lower);
        let is_temp_to = Self::is_temperature_unit(&to_lower);

        let result = if is_temp_from && is_temp_to {
            Self::convert_temperature(value, &from_lower, &to_lower)?
        } else {
            Self::convert_units(value, from_unit, to_unit)?
        };

        info!("Converted: {} {} = {} {}", value, from_unit, result, to_unit);
        
        Ok(json!({
            "value": value,
            "from": from_unit,
            "to": to_unit,
            "result": result,
            "formatted": format!("{} {} = {} {}", Self::format_number(value), from_unit, Self::format_number(result), to_unit),
            "success": true
        }))
    }

    fn stats(params: Value) -> Result<Value, WeaveError> {
        // Accept both "values" and "numbers" as parameter names for compatibility
        let values = params.get("values")
            .or_else(|| params.get("numbers"))
            .and_then(|v| v.as_array())
            .ok_or_else(|| WeaveError::PluginError("Missing 'numbers' (or 'values') parameter — expected an array of numbers".to_string()))?;
        
        let mut nums: Vec<f64> = values.iter()
            .filter_map(|v| v.as_f64())
            .collect();
            
        if nums.is_empty() {
            return Err(WeaveError::PluginError("Array must contain at least one valid number".to_string()));
        }
        
        let sum: f64 = nums.iter().sum();
        let count = nums.len() as f64;
        let mean = sum / count;
        
        nums.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let median = if nums.len() % 2 == 0 {
            (nums[nums.len() / 2 - 1] + nums[nums.len() / 2]) / 2.0
        } else {
            nums[nums.len() / 2]
        };
        
        let min = nums.first().cloned().unwrap_or(0.0);
        let max = nums.last().cloned().unwrap_or(0.0);

        // Standard deviation
        let variance = nums.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / count;
        let std_dev = variance.sqrt();
        
        info!("Calculated stats for {} numbers", count);
        
        Ok(json!({
            "count": count,
            "sum": sum,
            "mean": mean,
            "median": median,
            "min": min,
            "max": max,
            "std_dev": std_dev,
            "range": max - min,
            "success": true
        }))
    }

    fn evaluate_expression(expr: &str) -> Result<f64, WeaveError> {
        let sanitized: String = expr.chars()
            .filter(|c| !c.is_whitespace())
            .collect();
        
        let mut ctx = meval::Context::new();
        
        // Extended mathematical functions
        ctx.func("log", |x| x.log10());
        ctx.func("log10", |x| x.log10());
        ctx.func("log2", |x| x.log2());
        ctx.func("ln", |x| x.ln());
        ctx.func("exp", |x| x.exp());
        ctx.func("abs", |x| x.abs());
        ctx.func("ceil", |x| x.ceil());
        ctx.func("floor", |x| x.floor());
        ctx.func("round", |x| x.round());
        ctx.func("signum", |x| x.signum());
        ctx.func("rad", |x| x * std::f64::consts::PI / 180.0);
        ctx.func("deg", |x| x * 180.0 / std::f64::consts::PI);
        
        // Physical Constants
        ctx.var("c", 299792458.0); // Speed of light in m/s
        ctx.var("G", 6.67430e-11); // Gravitational constant
        ctx.var("h", 6.62607015e-34); // Planck constant
        ctx.var("hbar", 1.054571817e-34); // Reduced Planck constant
        ctx.var("k", 1.380649e-23); // Boltzmann constant
        ctx.var("N_A", 6.02214076e23); // Avogadro constant
        ctx.var("e_charge", 1.602176634e-19); // Elementary charge
        ctx.var("m_e", 9.1093837015e-31); // Electron mass
        ctx.var("m_p", 1.67262192369e-27); // Proton mass
        ctx.var("mu_0", 1.25663706212e-6); // Vacuum magnetic permeability
        ctx.var("eps_0", 8.8541878128e-12); // Vacuum electric permittivity
        ctx.var("R", 8.314462618); // Gas constant
        ctx.var("g", 9.80665); // Standard acceleration of gravity
        ctx.var("atm", 101325.0); // Standard atmosphere in Pa
        ctx.var("phi", 1.618033988749895); // Golden ratio

        let result = meval::eval_str_with_context(&sanitized, ctx)
            .map_err(|e| WeaveError::ParseError(format!("Expression evaluation error: {}", e)))?;
        
        if result.is_nan() {
            return Err(WeaveError::ParseError("Result is NaN".to_string()));
        }
        
        if result.is_infinite() {
            return Err(WeaveError::ParseError("Result is infinite (possible division by zero)".to_string()));
        }
        
        Ok(result)
    }

    fn is_temperature_unit(unit: &str) -> bool {
        matches!(unit,
            "c" | "°c" | "celsius" | "centigrade" |
            "f" | "°f" | "fahrenheit" | "farenheit" |
            "k" | "kelvin"
        )
    }

    fn convert_units(value: f64, from: &str, to: &str) -> Result<f64, WeaveError> {
        let from_lower = from.to_lowercase();
        let to_lower = to.to_lowercase();
        
        if from_lower == to_lower {
            return Ok(value);
        }
        
        let conversion = Self::get_conversion_factor(&from_lower, &to_lower)
            .ok_or_else(|| WeaveError::PluginError(
                format!("Conversion from '{}' to '{}' is not supported. Supported: length (km, miles, m, ft, in, cm), weight (kg, g, lb, oz), temperature (celsius, fahrenheit, kelvin), volume (l, ml, gal, qt, pt, cup)", from, to)
            ))?;
        
        Ok(value * conversion)
    }

    fn get_conversion_factor(from: &str, to: &str) -> Option<f64> {
        match (from, to) {
            (f, t) if f == t => Some(1.0),
            
            // Length
            ("km", "m") | ("kg", "g") => Some(1000.0),
            ("m", "km") | ("g", "kg") => Some(0.001),
            ("miles", "km") => Some(1.60934),
            ("km", "miles") => Some(0.621371),
            ("miles", "m") => Some(1609.34),
            ("m", "miles") => Some(0.000621371),
            ("ft", "m") | ("feet", "m") => Some(0.3048),
            ("m", "ft") | ("m", "feet") => Some(3.28084),
            ("in", "cm") | ("inch", "cm") | ("inches", "cm") => Some(2.54),
            ("cm", "in") | ("cm", "inch") | ("cm", "inches") => Some(0.393701),
            ("ft", "cm") | ("feet", "cm") => Some(30.48),
            ("cm", "ft") | ("cm", "feet") => Some(0.0328084),
            ("m", "cm") => Some(100.0),
            ("cm", "m") => Some(0.01),
            ("mm", "cm") => Some(0.1),
            ("cm", "mm") => Some(10.0),
            ("ft", "in") | ("feet", "in") | ("feet", "inches") => Some(12.0),
            ("in", "ft") | ("in", "feet") => Some(0.0833333),
            
            // Weight
            ("lb", "kg") | ("lbs", "kg") | ("pound", "kg") | ("pounds", "kg") => Some(0.453592),
            ("kg", "lb") | ("kg", "lbs") | ("kg", "pound") | ("kg", "pounds") => Some(2.20462),
            ("g", "lb") | ("g", "pound") => Some(0.00220462),
            ("lb", "g") | ("pound", "g") => Some(453.592),
            ("oz", "g") | ("ounce", "g") | ("ounces", "g") => Some(28.3495),
            ("g", "oz") | ("g", "ounce") | ("g", "ounces") => Some(0.035274),
            // Volume
            ("l", "ml") | ("liter", "ml") | ("liters", "ml") => Some(1000.0),
            ("ml", "l") | ("ml", "liter") | ("ml", "liters") => Some(0.001),
            ("gal", "l") | ("gallon", "l") | ("gallons", "l") => Some(3.78541),
            ("l", "gal") | ("l", "gallon") | ("l", "gallons") => Some(0.264172),
            ("qt", "l") | ("quart", "l") | ("quarts", "l") => Some(0.946353),
            ("l", "qt") | ("l", "quart") | ("l", "quarts") => Some(1.05669),
            ("pt", "l") | ("pint", "l") | ("pints", "l") => Some(0.473176),
            ("l", "pt") | ("l", "pint") | ("l", "pints") => Some(2.11338),
            ("cup", "l") | ("cups", "l") => Some(0.236588),
            ("l", "cup") | ("l", "cups") => Some(4.22675),
            ("fl oz", "ml") | ("floz", "ml") | ("fluid ounce", "ml") => Some(29.5735),
            ("ml", "fl oz") | ("ml", "floz") | ("ml", "fluid ounce") => Some(0.033814),
            ("gal", "qt") | ("gallon", "quart") => Some(4.0),
            ("qt", "gal") | ("quart", "gallon") => Some(0.25),
            ("qt", "pt") | ("quart", "pint") => Some(2.0),
            ("pt", "qt") | ("pint", "quart") => Some(0.5),
            ("pt", "cup") | ("pint", "cup") => Some(2.0),
            ("cup", "pt") | ("cup", "pint") => Some(0.5),
            
            _ => None,
        }
    }

    pub fn convert_temperature(value: f64, from: &str, to: &str) -> Result<f64, WeaveError> {
        if from == to {
            return Ok(value);
        }
        
        let celsius = match from {
            f if f.starts_with('c') || f.starts_with("°c") || f == "celsius" || f == "centigrade" => value,
            f if f.starts_with('f') || f.starts_with("°f") || f == "fahrenheit" || f == "farenheit" => (value - 32.0) * 5.0 / 9.0,
            f if f.starts_with('k') || f == "kelvin" => value - 273.15,
            _ => return Err(WeaveError::PluginError(format!("Unknown temperature unit: {}", from))),
        };
        
        let result = match to {
            t if t.starts_with('c') || t.starts_with("°c") || t == "celsius" || t == "centigrade" => celsius,
            t if t.starts_with('f') || t.starts_with("°f") || t == "fahrenheit" || t == "farenheit" => (celsius * 9.0 / 5.0) + 32.0,
            t if t.starts_with('k') || t == "kelvin" => celsius + 273.15,
            _ => return Err(WeaveError::PluginError(format!("Unknown temperature unit: {}", to))),
        };
        
        Ok(result)
    }

    fn format_number(n: f64) -> String {
        if n == n.trunc() {
            format!("{:.0}", n)
        } else if n.abs() >= 1_000_000.0 {
            format!("{:.4e}", n)
        } else {
            let s = format!("{:.10}", n);
            s.trim_end_matches('0').trim_end_matches('.').to_string()
        }
    }
}
