(function() {
    /* Configurable constants:
    *
    * PATH_SEPARATOR    Set accordingly depending on environment ('\\' for Windows, '/' for Linux)
    *
    * REPORT_DIR        Location of the jrxml files. This will include all subdirectories.
    *
    * OUTPUT_FILE       Location of the file to output data to.
    *
    */
    var PATH_SEPARATOR = '\\',
        REPORT_DIR = __dirname + PATH_SEPARATOR + 'Reports',
        OUTPUT_FILE = __dirname + PATH_SEPARATOR + 'reports.xlsx'; // NOT YET SUPPORTED
        
    var XmlDocument = require('xmldoc').XmlDocument,
        fs = require('fs');//,
        //xlsx = require('node-xlsx');
        
    global.maxFilesInFlight = 100;
    
    var _origRead = fs.readFile,
        _origWrite = fs.writeFile,
        _activeCount = 0,
        _pending = [],
        _wrapCallback = function(cb) {
            return function(){
                _activeCount--;
                cb.apply(this,Array.prototype.slice.call(arguments));
                if (_activeCount < global.maxFilesInFlight && _pending.length){
                    _pending.shift()();
                }
            };
        },
        _parseTypes = {
            QUERYSTRING: 0,
            PARAMETERS: 1,
            FIELDS: 2,
            VARIABLES: 3,
            SUBREPORTS: 4
        };

    // Override readFile() to prevent 'too many open files' error
    fs.readFile = function() {
        var args = Array.prototype.slice.call(arguments);
        
        if (_activeCount < global.maxFilesInFlight){
            if (args[1] instanceof Function){
                args[1] = _wrapCallback(args[1]);
            } else if (args[2] instanceof Function) {
                args[2] = _wrapCallback(args[2]);
            }
            
            _activeCount++;
            _origRead.apply(fs,args);
        } else {
            _pending.push(function(){
                fs.readFile.apply(fs,args);
            });
        }
    };

    // Recursively walk the directory structure
    function walk(dir, done) {
        var results = [];

        fs.readdir(dir, function (err, list) {
            var count;
            
            if (err) {
                return done(err);
            }

            count = list.length;
            if (!count) {
                return done(null, results);
            }

            list.forEach(function (file) {
                var filename = dir + PATH_SEPARATOR + file;
                
                fs.stat(filename, function (err, stat) {
                    if (stat && stat.isDirectory()) {
                        walk(filename, function (err, res) {
                            results = results.concat(res);
                            if (! --count) {
                                done(null, results);
                            }
                        });
                    } else {
                        if (/\.jrxml$/.test(filename)) {
                            results.push(filename);
                        }
                        
                        if (!--count) {
                            done(null, results);
                        }
                    }
                });
            });
        });
    };

    function cleanupString(value, enclose) {
        var result;

        if (!value || !value.length) {
            return '';
        }
        
        result = value
            // Normalize line breaks
            .replace(/\r\n/gm, '\n')                
            // Strip multi-line string concats and remove extraneous space
            .replace(/(?:"\s*\n\s*\+\s*")|(?:"\s*\+\s*\n\s*")/g, '\n')
            // Remove unnecessarily quoted strings which use concatenation
            .replace(/\s*"([^"]*)"\s*\+(?!\s*\()\s*/mg, '$1')
            // Strip leading and trailing spaces (for all lines)
            .replace(/^\s+|\s+$/gm, '')
            // Remove quotes from single-line value without concatenation
            .replace(/^"([^"\n]+)"$/g, '$1')
            // Escape any escape sequences
            .replace(/\\/g, '\\\\')
            // Escape any double quotes
            .replace(/"/g, '""');
        
        return enclose ? '"' + result + '"' : result;
    }

    function parseParameters(path, file, elements) {
        var item, value,
            dataType,
            el,
            i, len;

        for (i = 0, len = elements.length; i < len; i++) {
            item = elements[i];
        
            dataType = item.attr.class;
            dataType = dataType && dataType.substr(dataType.lastIndexOf('.') + 1);
            
            el = item.childNamed('defaultValueExpression');
            value = el && el.val;
            value = (value && dataType == 'String') ? cleanupString(value, true) : '';
            
            console.log('%s,%s,%s,%s,%s', path, file, item.attr.name, dataType, value);
        }
    }

    function parseQueryString(path, file, elements) {
        var item,
            value,
            i, len;

        for (i = 0, len = elements.length; i < len; i++) {
            item = elements[i];
        
            value = item && item.val;
            value = value ? cleanupString(value, true) : '';
           
            console.log('%s,%s,%s', path, file, value);
        }
    }

    function parseFields(path, file, elements) {
        var item,
            i, len;
        
        for (i = 0, len = elements.length; i < len; i++) {
            item = elements[i];
            
            dataType = item.attr.class;
            dataType = dataType && dataType.substr(dataType.lastIndexOf('.') + 1);
            
            console.log('%s,%s,%s,%s', path, file, item.attr.name, dataType);
        }
    }

    // Used for debugging
    function repeatStr(chr, times) {
        var result = [],
            i;
        
        for (i = 0; i < times + 1; i++) {
            result.push(chr);
        }
        
        return result.join('');
    }

    function unshiftLocation(subreports, node, depth) {
        if (subreports) {
            for (i = subreports.length; i--; ) {
                subreports[i].location.unshift(node);
            }
        }
    }
    
    function setSubreportValue(subreports, key, value) {
        if (subreports) {
            for (i = subreports.length; i--; ) {
                if (subreports[i][key]) {
                    console.log('CONFLICT: %s:%s', key, value);
                }
                
                subreports[i][key] = value;
            }
        }
    }

    function extractSubreportElements(xml) {
        var elements,
            el,
            subreport = { 
                name: '',
                key: '',
                printWhen: '',
                paramMap: '',
                paramMapExpression: '',
                expression: '',
                parameters: [],
                location: [xml.name]
            };
        
        // Check if `subreportExpression` exists as child of `xml`
        el = xml.childNamed('subreportExpression');
        if (el && el.val) {
            value =cleanupString(el.val, true);
            subreport.expression = value;
        } 
        
        // Check if `parametersMapExpression` exists as child of `xml`
        el = xml.childNamed('parametersMapExpression');
        if (el && el.val) {
            value = cleanupString(el.val, true);
            if (value === '"$P{REPORT_PARAMETERS_MAP}"' || value === '"new HashMap($P{REPORT_PARAMETERS_MAP})"') {
                subreport.paramMap = 'Y'
            } else {
                subreport.paramMapExpression = value;
            }
        } 

        // Check if `reportElement` with attribute `key` exists as child of `xml`
        el = xml.childNamed('reportElement');
        if (el && el.attr.key) {
            value = cleanupString(el.attr.key, true);
            subreport.key = value;
        } 
        
        // Check for any `subreportParameter` elements which are a child of `xml`
        xml.eachChild(function (element) {
            var param = { name: '', value: '' };
            
            if (element.name === 'subreportParameter') {
                value = element.attr.name;
                param.name = value ? cleanupString(value, true) : '';
                
                el = element.childNamed('subreportParameterExpression');
                value = el && el.val;
                param.value = value ? cleanupString(value, true) : '';
                
                subreport.parameters.push(param);
            }
        });
        
        return subreport;
    } 
    
    function dumpSubreportInfo(path, file, subreports) {
        var item, params = i, len;
        
        while (subreports.length) {
            item = subreports.pop();
            
            params = item.parameters;
            if (!params || !params.length) {
                params = [{ name: '', value: '' }];
            }
            
            for (i = 0, len = params.length; i < len; i++) {
                console.log(
                    '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s', 
                    path,
                    file, 
                    item.location.join('/'),
                    item.name,
                    item.key, 
                    item.printWhen, 
                    item.expression,
                    item.paramMap,
                    item.paramMapExpression,
                    params[i].name,
                    params[i].value
                );
            }
        }
    }
    
    function parseSubreports(path, file, xml, depth) {
        var nodeDepth = depth || 0,
            result = null,
            value;
        
        xml.eachChild(function (element) {
            var subreport, item, i;
            
            // console.log('%s %s', repeatStr('.', nodeDepth), element.name); /* DEBUG */
            
            // Check if we have hit a `subreport` node
            if (element.name === 'subreport') {
                result = result || [];
                subreport = extractSubreportElements(element);
                result.push(subreport);
            } else {
                // Get subreport info from this child node (if present)
                subreport = parseSubreports(path, file, element, nodeDepth + 1);
                if (subreport) {
                    result = subreport;
                }
            }
        });
    
        if (result && result.length) {
            // We are in the parent node of a subreport element
            
            unshiftLocation(result, xml.name, nodeDepth);
            if (xml.attr.name) {
                value = '"' + cleanupString(xml.attr.name) + '"';
                setSubreportValue(result, 'name', value);
            }
            
            // Check if `printWhenExpression` exists at same depth as `subreport`
            xml.eachChild(function (element) {
                if (element.name === 'printWhenExpression') {
                    value = cleanupString(element.val, true);
                    setSubreportValue(result, 'printWhen', value);
                }
            });
        }
        
        if (result && nodeDepth === 1) {
            dumpSubreportInfo(path, file, result);
            result = null;
        }
            
        return result;
    }

    function reportParser(parseType) {
        walk(REPORT_DIR, function (err, results) {
            var i, len;

            if (err) {
                throw err;
            }

            for (i = 0, len = results.length; i < len; i++) {
                fs.readFile(results[i], 'utf8', (function (filename) {
                    return function (err, data) {
                        var xml, elements,
                            path, file;
                        
                        if (err) {
                            return console.log(err);
                        }

                        // Parse the XML
                        xml = new XmlDocument(data);
                        
                        // Extract path and filename
                        path = filename.substring(0, filename.lastIndexOf(PATH_SEPARATOR));
                        file = filename.substr(filename.lastIndexOf(PATH_SEPARATOR) + 1);
                        
                        if (parseType == _parseTypes.PARAMETERS) {
                            parseParameters(path, file, xml.childrenNamed('parameter'));
                        } else if (parseType == _parseTypes.QUERYSTRING) {
                            parseQueryString(path, file, xml.childrenNamed('queryString'));
                        } else if (parseType == _parseTypes.FIELDS) {
                            parseFields(path, file, xml.childrenNamed('field'));
                        } else if (parseType == _parseTypes.SUBREPORTS) {
                            parseSubreports(path, file, xml);
                        }
                    };
                } (results[i].substr(REPORT_DIR.length))));
            }
        });
    }

    if (process.argv.length > 2) {
        switch (process.argv[2]) {
            case 'params':
            case 'parameters':
                reportParser(_parseTypes.PARAMETERS);
                console.log('"path","filename","name","data_type","value"');
                break;
            case 'query':
            case 'querystring':
                reportParser(_parseTypes.QUERYSTRING);
                console.log('"path","filename","value"');
                break;
            case 'fields':
                reportParser(_parseTypes.FIELDS);
                console.log('"path","filename","name","data_type"');
                break;
            case 'vars':
            case 'variables':
                //reportParser(_parseTypes.VARIABLES);
                //console.log('"path","filename","name","data_type"');
                break;
            case 'sub':
            case 'subs':
            case 'subreports':
                console.log('"path","filename","xpath","name","key","print_when","expression","param_map","param_map_expression","param_name","param_value"');
                reportParser(_parseTypes.SUBREPORTS);
                break;
            default:
                console.log('Unknown parameter: "' + rocess.argv[2] + '"');
        }
    } else {
        console.log(
            'Usage: node jrxmlParse.js type\n' +
            '\n' +
            'type:\n' +
            '  parameters\n' +
            '  query\n' +
            '  fields\n' +
            '  subreports\n'
        );
    }
}());