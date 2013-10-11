(function() {
    /* Configurable constants:
    *
    * REPORT_DIR        Location of the jrxml files. This will include all subdirectories.
    *
    * OUTPUT_FILE       Location of the file to output data to.
    *
    */
    var PATH_SEPARATOR = __dirname.substring(1, 0) === '/' ? '/' : '\\',
        REPORT_DIR = __dirname + PATH_SEPARATOR + 'Reports',
        OUTPUT_FILE = __dirname + PATH_SEPARATOR + 'report_catalogue.xlsx',
        xmlDoc = require('xmldoc'),
        util = require('util'),
        fs = require('fs'),
        xlsx = require('node-xlsx');
    
    var _origRead = fs.readFile,
        _origWrite = fs.writeFile,
        _activeCount = 0,
        _pending = [],
        _worksheets = [],
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
   
    global.maxFilesInFlight = 100;
    
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
    
    function writeToFile(filename, data) {
        var buffer = xlsx.build({ worksheets: data }); 
        
        fs.writeFile(filename, buffer, function(err) {
            if(err) {
                console.log(err);
            } else {
                console.log('Output file saved to: ' + filename);
            }
        }); 
    }
    
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
                            if (--count === 0) {
                                done(null, results);
                            }
                        });
                    } else {
                        if (/\.jrxml$/.test(filename)) {
                            results.push(filename);
                        }
                        
                        if (--count === 0) {
                            done(null, results);
                        }
                    }
                });
            });
        });
    }

    function cleanupString(value, enclose) {
        var result;

        if (!value || !value.length) {
            return '';
        }
        
        // Note: most of the regex below was to clean the strings when outputing
        // to csv format. If writing to an xlsx file, it is not neccesary.
        
        result = value
            // Normalize line breaks
            .replace(/\r\n/gm, '\n')                
            // Strip multi-line string concats and remove extraneous space
            //.replace(/(?:"\s*\n\s*\+\s*")|(?:"\s*\+\s*\n\s*")/g, '\n')
            // Remove unnecessarily quoted strings which use concatenation
            //.replace(/\s*"([^"]*)"\s*\+(?!\s*\()\s*/mg, '$1')
            // Strip leading and trailing spaces (for all lines)
            //.replace(/^\s+|\s+$/gm, '')
            // Remove quotes from single-line value without concatenation
            //.replace(/^"([^"\n]+)"$/g, '$1')
            // Escape any escape sequences
            //.replace(/\\/g, '\\\\')
            // Escape any double quotes
            //.replace(/"/g, '""');
        
        return result;
    }

    var ReportComponent = (function() {
        function ReportComponent(sheetName, sheetHeader) {
            if (!(this instanceof ReportComponent)) {
                return new ReportComponent(sheetName, sheetHeader);
            }
            
            this._data = [];
            this._name = sheetName;
            this._header = sheetHeader;
        }
        
        ReportComponent.prototype.parseXml = function(xml, fileId) {
            // Template
        }
        
        ReportComponent.prototype.addWorksheet = function(worksheets) {
            var data = this._data,
                header = this._header,
                rows = [header],
                cols = header.length,
                i, len, item, 
                j, lenJ, row;
        
            console.log('Adding worksheet: "%s" (%s rows)', this._name, data.length);
            
            for (i = 0, len = data.length; i < len; i++) {
                item = data[i];
                
                row = [];
                for (j = 0; j < cols; j++) {
                    row.push(item[header[j]]);
                }
                
                rows.push(row);
            } 
            
            worksheets.push({ name: this._name, data: rows });
        }
        
        return ReportComponent;
    }());
    
    var files = (function() {
        var SHEET_NAME = 'files',
            SHEET_HEADER = [
                'id',
                'path_name',
                'file_name'
            ],
            _data = [],
            _parsed = 0,
            _percent = 0,
            _errors = [];
        
        function addFilenames(array) {
            var relative,
                index, dir,
                item, i, len;
            
            for (i = 0, len = array.length; i < len; i++) {
                item = array[i];
                
                index = item.lastIndexOf(PATH_SEPARATOR);
                
                dir = item.substring(0, index)
                if (dir.substring(0, REPORT_DIR.length) === REPORT_DIR) {
                    dir = dir.substr(REPORT_DIR.length);
                }
                
                item = {
                    id: i + 1,
                    path: dir,
                    name: item.substr(index + 1),
                    full_filename: item
                };
                
                _data.push(item);
            }
        }
        
        function getFileId(path, name) {
            var i, len, item, dir, file, index;
            
            if (arguments.length === 1) {
                index = path.lastIndexOf(PATH_SEPARATOR);
                
                dir = path.substring(0, index);
                file = path.substr(index + 1);
                
                if (dir.substring(0, REPORT_DIR.length) === REPORT_DIR) {
                    dir = dir.substr(REPORT_DIR.length);
                }
            } else {
                dir = path && path.replace(/^/|/$|^\\|\\$/g, '');
                file = name;
            }
            console.log('%s ?= %s'. dir, path);
            console.log('%s ?= %s'. file, name);
            file = file.replace(/\.jrxml$|\.jasper$/, '');
            
            for (i = 0, len = _data.length; i < len; i++) {
                item = _data[i];
            
                if (file === item.name && (!dir || dir === item.path)) {
                    return item.id;
                }
            }
            
            return null;
        }
        
        function updateStatus() {
            var completed = _errors.length + _parsed,
                total = _data.length,
                percent = (completed / total) * 100;
            
            if (completed >= total) {
                return true;
            } else {
                if (percent < Math.ceil(percent) && Math.ceil(percent) !== _percent) {
                    _percent = Math.ceil(percent);
                    util.print(_percent + '% complete  \n\x1B[1G\x1B[1A');
                }
            }
            
            return false;
        }
        
        function addWorksheet(worksheets) {
            var rows = [SHEET_HEADER],
                i, len, file;
        
            for (i = 0, len = _data.length; i < len; i++) {
                file = _data[i];
                rows.push([ file.id, file.path, file.name.replace(/\.jrxml$|\.jasper$/, '') ]);
            } 
            
            worksheets.push({ name: SHEET_NAME, data: rows });
        }
        
        function parseXmlFiles(filenames, callback) {
            var XmlDocument = xmlDoc.XmlDocument,
                i, len;
            
            addFilenames(filenames);
            
            for (i = 0, len = _data.length; i < len; i++) {
                fs.readFile(_data[i].full_filename, 'utf8', (function (file) {
                    return function (err, data) {
                        var xml;
                        
                        if (err) {
                            _errors.push(err);
                            if (updateStatus()) {
                                callback(false, null);
                            }
                        }
                        if (_errors.length) {
                            return;
                        }
                        
                        xml = new XmlDocument(data);
                        
                        parameters.parseXml(xml, file.id);
                        queryStrings.parseXml(xml, file.id);
                        fields.parseXml(xml, file.id);
                        variables.parseXml(xml, file.id);
                        subreports.parseXml(xml, file.id);
                        
                        _parsed++;
                    
                        if (updateStatus()) {
                            callback(true, null);
                        }
                    };
                } (_data[i])));
             }
        }
        
        return {
            addFilenames: addFilenames,
            
            addWorksheet: addWorksheet,
            
            parseXmlFiles: parseXmlFiles
        };
    }());
    
    var parameters = (function() {
        var SHEET_NAME = 'parameters',
            SHEET_HEADER = [
                'id',
                'file_id',
                'subreport_id',
                'name', 
                'value', 
                'data_type'
            ],
            _component = new ReportComponent(SHEET_NAME, SHEET_HEADER);
            
        _component.addSubreportParam = function(fileId, subreportId, name, value) {
            var data = this._data,
                item, value;
                
            item = {
                id: data.length + 1,
                file_id: fileId,
                subreport_id: subreportId,
                name: name,
                value: value,
                data_type: ''
            };
            
            data.push(item);
        };
        
        _component.parseXml = function(xml, fileId) {
            var elements = xml.childrenNamed('parameter'),
                data = this._data,
                dataType, el, value,
                item, i, len;
            
            for (i = 0, len = elements.length; i < len; i++) {
                item = elements[i];
                
                dataType = item.attr.class;
                dataType = dataType && dataType.substr(dataType.lastIndexOf('.') + 1);
                    
                el = item.childNamed('defaultValueExpression');
                value = el && el.val;
                value = (value && dataType == 'String') ? cleanupString(value, true) : value;
                
                item = {
                    id: data.length + 1,
                    file_id: fileId,
                    subreport_id: '',
                    name: item.attr.name,
                    value: value || '',
                    data_type: dataType || ''
                };
                
                data.push(item);
            }
        }
        
        return _component;
    }());
    
    var fields = (function() {
        var SHEET_NAME = 'fields',
            SHEET_HEADER = [
                'id', 
                'file_id', 
                'name', 
                'data_type'
            ],
            _component = new ReportComponent(SHEET_NAME, SHEET_HEADER);
            
        _component.parseXml = function(xml, fileId) {
            var elements = xml.childrenNamed('field'),
                data = this._data,
                dataType,
                item, i, len;
            
            for (i = 0, len = elements.length; i < len; i++) {
                item = elements[i];
                
                dataType = item.attr.class;
                dataType = dataType && dataType.substr(dataType.lastIndexOf('.') + 1);
                
                item = {
                    id: data.length + 1,
                    file_id: fileId,
                    name: item.attr.name,
                    data_type: dataType
                };
                
                data.push(item);
            }
        }
        
        return _component;
    }());
    
    var variables = (function() {
        var SHEET_NAME = 'variables',
            SHEET_HEADER = [
                'id',
                'file_id',
                'name',
                'value'
            ],
            _component = new ReportComponent(SHEET_NAME, SHEET_HEADER);
            
        _component.parseXml = function(xml, fileId) {
            var elements = xml.childrenNamed('variable'),
                data = this._data,
                dataType, el, value,
                item, i, len;
            
            for (i = 0, len = elements.length; i < len; i++) {
                item = elements[i];
                
                dataType = item.attr.class;
                dataType = dataType && dataType.substr(dataType.lastIndexOf('.') + 1);
                    
                el = item.childNamed('variableExpression');
                value = el && el.val;
                value = (value && dataType == 'String') ? cleanupString(value, true) : value;
                
                item = {
                    id: data.length + 1,
                    file_id: fileId,
                    name: item.attr.name,
                    value: value || '',
                    data_type: dataType || ''
                };
                
                data.push(item);
            }
        }
        
        return _component;
    }());
    
    var queryStrings = (function() {
        var SHEET_NAME = 'queryStrings',
            SHEET_HEADER = [
                'id',
                'file_id',
                'value'
            ],
            _component = new ReportComponent(SHEET_NAME, SHEET_HEADER);
            
        _component.parseXml = function(xml, fileId) {
            var elements = xml.childrenNamed('queryString'),
                data = this._data,
                item, value,
                i, len;

            for (i = 0, len = elements.length; i < len; i++) {
                item = elements[i];
            
                value = item && item.val;
                value = cleanupString(value);
               
                item = {
                    id: data.length + 1,
                    file_id: fileId,
                    value: value
                };
                
                data.push(item);
            }
        }
        
        return _component;
    }());

    var subreports = (function() {
        var SHEET_NAME = 'subreports',
            SHEET_HEADER = [
                'id',
                'file_id',
                'name',
                'key',
                'print_when',
                'expression',
                'param_map',
                'param_map_expression'
            ]
            _component = new ReportComponent(SHEET_NAME, SHEET_HEADER);
                
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
                el, value,
                subreport = { 
                    name: '',
                    key: '',
                    print_when: '',
                    param_map: '',
                    param_map_expression: '',
                    expression: '',
                    parameters: []
                };
            
            // Check if `subreportExpression` exists as child of `xml`
            el = xml.childNamed('subreportExpression');
            if (el && el.val) {
                value = cleanupString(el.val);
                subreport.expression = value;
            } 
            
            // Check if `parametersMapExpression` exists as child of `xml`
            el = xml.childNamed('parametersMapExpression');
            if (el && el.val) {
                value = cleanupString(el.val);
                if (value === '$P{REPORT_PARAMETERS_MAP}' || value === 'new HashMap($P{REPORT_PARAMETERS_MAP})') {
                    subreport.param_map = 'Y'
                } else {
                    subreport.param_map_expression = value;
                }
            } 

            // Check if `reportElement` with attribute `key` exists as child of `xml`
            el = xml.childNamed('reportElement');
            if (el && el.attr.key) {
                subreport.key = cleanupString(el.attr.key);
            } 
            
            // Check for any `subreportParameter` elements which are a child of `xml`
            xml.eachChild(function (element) {
                var param = { name: '', value: '' },
                    value, el;
                
                if (element.name === 'subreportParameter') {
                    value = element.attr.name;
                    param.name = cleanupString(value);
                    
                    el = element.childNamed('subreportParameterExpression');
                    value = el && el.val;
                    param.value = cleanupString(value);
                    
                    subreport.parameters.push(param);
                }
            });
            
            return subreport;
        } 
        
        function addSubreport(subreports, fileId) {
            var data = _component._data,
                item, params, 
                i, len;
            
            while (subreports.length) {
                item = subreports.pop();
                
                params = item.parameters;
                delete item.parameters;
                
                item.id = data.length + 1;
                item.file_id = fileId;
                
                data.push(item);
                
                for (i = 0, len = params.length; i < len; i++) {
                    parameters.addSubreportParam(fileId, item.id, params[i].name, params[i].value);
                }
            }
        }
        
        function parseSubreports(xml, fileId, depth) {
            var nodeDepth = depth || 0,
                result = null,
                value;
            
            xml.eachChild(function (element) {
                var subreport, item, i;
                
                // Check if we have hit a `subreport` node
                if (element.name === 'subreport') {
                    result = result || [];
                    subreport = extractSubreportElements(element);
                    result.push(subreport);
                } else {
                    // Get subreport info from this child node (if present)
                    subreport = parseSubreports(element, fileId, nodeDepth + 1);
                    if (subreport) {
                        result = subreport;
                    }
                }
            });
        
            if (result && result.length) {
                // We are in the parent node of a subreport element
                
                if (xml.attr.name) {
                    value = cleanupString(xml.attr.name);
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
                addSubreport(result, fileId);
                result = null;
            }
                
            return result;
        }

        _component.parseXml = function(xml, fileId) {
            parseSubreports(xml, fileId);
        };
        
        return _component;
    }());
    
    var subreportConfig = (function(){
        var SHEET_NAME = 'subreportConfig',
            SHEET_HEADER = [
                'id',
                'subreport_id',
                'is_default',    // 'Y' if value is from default configuration
                'param_name',    // Name of the parameter
                'value',         // The parameter value
                'file_id'        // The report file which the subreport expression will evaluate to
            ]
            _component = new ReportComponent(SHEET_NAME, SHEET_HEADER);
            
        /*
        * Evaluates subreport expressions to determine all possible subreport files which can be
        * referenced based on specific combinations of report configuration parameters.
        */
        _component.linkSubreports = function() {
            // TODO: Implement
        };
        
        return _component;
    }());
    
    function reportParser() {
        console.log('\nScanning \'%s\' for report files...\n', REPORT_DIR);
        
        walk(REPORT_DIR, function(err, results) {
            if (err) {
                throw err;
            }
            
            console.log('JRXML files identified: %s', results.length);

            files.parseXmlFiles(results, function(success, data) {
                if (!success) {
                    console.log('Failed to parse files! The following errors occured:\n');
                    
                    for (var i = 0, len = data.length; i < len; i++) {
                        console.log(data[i]);
                    }
                } else {
                    // TODO: Final step: interpret all raw values and link up subreports and parameters
                    subreportConfig.linkSubreports();
                    
                    files.addWorksheet(_worksheets);
                    parameters.addWorksheet(_worksheets);
                    queryStrings.addWorksheet(_worksheets);
                    fields.addWorksheet(_worksheets);
                    variables.addWorksheet(_worksheets);
                    subreports.addWorksheet(_worksheets);
                    subreportConfig.addWorksheet(_worksheets);
                    
                    console.log('Writing output to "' + OUTPUT_FILE + '"');
                    
                    writeToFile(OUTPUT_FILE, _worksheets);
                    
                    console.log('Done!');
                }
            });
        });
    }
    
    // Start parsing
    reportParser();
}());