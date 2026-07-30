// JSON 数据目录：基于站点部署根路径（Astro/Vite 注入的 import.meta.env.BASE_URL），
// 避免相对路径在嵌套路由（如 /news/detail）下解析错位
var baseUrl = ((import.meta.env && import.meta.env.BASE_URL) || '/').replace(/\/?$/, '/') + 'jsonDatas/'

/* 数据列表处理
	* api 需要获取的数据JSON文件
	* datas {
		** data_type 数据返回格式 'page || list || show' 默认'page'
		*** 'page': {
				total: (总条数)
				last_page: (总页数)
				data: (数据列表)
			}
		*** 'list': list(数据列表)
		*** 'show': {
				up: (上一条数据),
				down: (下一条数据),
				info: (详情内容)
			}
		** page 当前页 默认1
		** limit 每页显示条数 默认10  获取全部数据时可设置为-1
		** category_id 分类id筛选
		** id  列表数据id筛选
		** sort 排序筛选 timeAsc时间正序、timeDesc时间倒序、sortAsc排序ID正序、sortDesc排序ID倒序
		** list_type all取所有数据（包含所有子级） alone只取当前分类所有数据（不包含所有子级）children分类子集递归查询 默认为alone
		** type 类型筛选（主要用于category.json分类筛选） goods产品 content文章 text信息 carousel轮播 image图片
		** column_id 栏目ID筛选(栏目ID从制作端查看)
		** search_name 标题筛选模糊查找
		** browse  是否统计阅读量（仅限获取详情使用）
		** method  请求方式  session:缓存session
	} 数据筛选条件
*/

// 全局缓存数据（api -> JSON 字符串）
var jsonArr = {}
// 进行中的请求（api -> Promise）：同一 api 的并发调用复用同一次请求，替代原 requestList/requestWait 排队机制
var requestPromises = {}
//
var cateJson

/* 请求数据（async/await 版）
 * 返回 Promise，可直接 await 拿到结果：const res = await requestData('site')
 * 第 3 个参数 callBack 保留，兼容旧回调写法：requestData('site', null, res => {...})
 * 原第 4 个参数 async 已废弃（fetch 恒为异步），传入会被忽略
 */
async function requestData(api, data = null, callBack) {
    // filterDataList 依赖分类数据，先确保 category 就绪
    cateJson = JSON.parse(await loadJson('category', data))
    var response = JSON.parse(await loadJson(api, data))
    var result = data ? filterDataList(api, data, response) : response
    if (typeof callBack === 'function') callBack(result)
    return result
}

// 获取缓存数据
function getData(api, data) {
    var result
    if (data && data.method == 'session' && typeof window !== 'undefined') result = window.sessionStorage.getItem(api) || jsonArr[api]
    else result = jsonArr[api]
    return result
}

// 加载 JSON 字符串：缓存命中直接返回；未命中时复用进行中的请求，或发起新请求
function loadJson(api, data) {
    var cached = getData(api, data)
    if (cached) return Promise.resolve(cached)
    if (!requestPromises[api]) {
        requestPromises[api] = fetchJson(api, data).catch(function (error) {
            // 请求失败：清掉占位，允许后续调用重试，避免永久挂起
            delete requestPromises[api]
            console.error('[jzt_common] 加载 ' + api + '.json 失败:', error)
            throw error
        })
    }
    return requestPromises[api]
}

// 实际请求：SSR/SSG 环境读取文件系统，浏览器环境用 fetch；写入缓存并返回 JSON 字符串
async function fetchJson(api, data) {
    var url = baseUrl + api + '.json?v=' + Date.now()
    var result

    if (typeof window === 'undefined' && url.startsWith('/')) {
        // SSR/SSG：动态导入 Node.js 模块（仅在服务端可用），直接读取 public 目录
        const [pathModule, fsModule] = await Promise.all([import('path'), import('fs')])
        var publicDir = pathModule.resolve(process.cwd(), 'public')
        var filePath = pathModule.join(publicDir, url.split('?')[0])
        result = JSON.parse(fsModule.readFileSync(filePath, 'utf8'))
    } else {
        var res = await fetch(url)
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.url)
        result = await res.json()
    }

    var jsonStr = JSON.stringify(result)
    try {
        if (data && data.method == 'session' && typeof window !== 'undefined') window.sessionStorage.setItem(api, jsonStr)
        else jsonArr[api] = jsonStr
    } catch (error) {
        console.log(error)
        jsonArr[api] = jsonStr
    }
    return jsonStr
}

/**
 * 排序方法
 */
function dataSort(sort, arr) {
    if (sort) {
        arr.sort(function (a, b) {
            //a,b表示相邻的两个元素
            //若返回值>0,数组元素将按升序排列
            //若返回值<0,数组元素将按降序排列
            switch (sort) {
                case 'sortAsc':
                    return a.sort - b.sort
                case 'sortDesc':
                    return b.sort - a.sort
                case 'timeAsc':
                    return a.create_time - b.create_time
                case 'timeDesc':
                    return b.create_time - a.create_time
            }
        })
    }
    return arr
}

/**
 * 数据列表处理
 */
function filterDataList(api, condition, data) {
    var data_type = condition.data_type || 'page';
    var page = condition.page || 1
    var limit = condition.limit || 10
    var category_id = condition.category_id
    var id = condition.id
    var sort = condition.sort
    var type = condition.type
    var column_id = condition.column_id
    var list_type = condition.list_type || 'alone'
    var search_name = condition.search_name
    // 是否启用精确搜索
    var exact_search = condition.exact_search || false
    var newData = data
    var total = data.length
    var last_page = Math.ceil(total / limit)
    var up, down
    var search_to_lowerCase = condition.search_to_lowerCase || false // 是否开启大小写转换
    var search_in_intro_detail = condition.search_in_intro_detail || false // 是否开启从简介和详情中搜索

    // 栏目id筛选
    if (column_id) {
        newData = newData.filter(item => item.column_id == column_id)
    }

    // 日期处理
    newData.forEach(item => {
        try { item.create_time = new Date(item.create_time.replace(/-/g, '/')).getTime() }
        catch (e) { }
    })

    // 指定数据处理
    var topList = newData.filter(item => item.is_top == 1)
    topList = dataSort(sort, topList)
    var dataList = newData.filter(item => item.is_top != 1)
    dataList = dataSort(sort, dataList)
    if (topList.length || dataList.length) newData = topList.concat(dataList)
    else newData = dataSort(sort, newData)

    if (category_id && list_type == 'alone') {
        newData = newData.filter(item => {
            if (api == 'category' || api == 'navigation' || type == 'navigation') {
                return item.pid == category_id
            } else {
                // return item.category_id == category_id
                return item.category_id.split(',').some(item => category_id.split(',').includes(item))
            }
        })
    }
    if (category_id && (list_type == 'all' || list_type == 'children')) {
        var cateList = [], cateList_ = [];

        var type_category = condition.type || api
        if (api == 'category' || type == 'navigation') type_category = type
        if (api == 'navigation') type_category = 'navigation'

        cateList = filterDataList('category', { type: type_category, column_id, sort: sort, limit: -1, data_type: 'list' }, cateJson)
        // if(api === 'navigation') console.log(cateList, 'cateList')
        cateList_ = cateList.filter(item => {
            return item.id == category_id
        })
        if (list_type == 'children' && cateList_.length > 0) {
            cateList_ = childTree(cateList_[0].id)
        } else {
            cateList_ = cateList_.concat(childTree(category_id))
        }
        if (api == 'category' || api == 'navigation' || type == 'navigation') {
            newData = cateList_
        } else {
            newData = newData.filter(item => {
                return cateList_.find(prop => {
                    // return prop.id == item.category_id
                    return item.category_id && item.category_id.split(',').some(item_ => prop.id.includes(item_))
                })
            })
        }

        // 递归获取子分类
        function childTree(pid) {
            var tree = []
            var list = cateList.filter(item => {
                return item.pid == pid
            })
            if (list && list.length > 0) {
                if (list_type == 'children') {
                    tree = list.map(item => {
                        item.children = childTree(item.id)
                        return item
                    })
                } else {
                    tree = tree.concat(list)
                    list.forEach(item => {
                        tree = tree.concat(childTree(item.id))
                    })
                }
            }
            return tree
        }
    }
    if (type) {
        newData = newData.filter(item => item.type == type)
    }
    if (search_name) {
        // 将newData中 title转为字符串
        newData.forEach(item => { item.title = item.title.toString() })
        if (search_to_lowerCase) {
            search_name = search_name.toLowerCase();
            if (search_in_intro_detail) {
                if (exact_search) {
                    newData = newData.filter(item => item.title.toLowerCase() === search_name || item.intro.toLowerCase() === search_name || item.details.toLowerCase() === search_name)
                } else {
                    newData = newData.filter(item => item.title.toLowerCase().includes(search_name) || item.intro.toLowerCase().includes(search_name) || item.details.toLowerCase().includes(search_name))
                }
            } else {
                if (exact_search) {
                    newData = newData.filter(item => item.title.toLowerCase() === search_name)
                } else {
                    newData = newData.filter(item => item.title.toLowerCase().includes(search_name))
                }
            }
        } else {
            if (search_in_intro_detail) {
                if (exact_search) {
                    newData = newData.filter(item => item.title === search_name || item.intro === search_name || item.details === search_name)
                } else {
                    newData = newData.filter(item => item.title.includes(search_name) || item.intro.includes(search_name) || item.details.includes(search_name))
                }
            } else {
                if (exact_search) {
                    newData = newData.filter(item => item.title === search_name)
                } else {
                    newData = newData.filter(item => item.title.includes(search_name))
                }
            }
        }
    }
    if (id) {
        newData = newData.filter((item, index, arr) => {
            if (item.id == id) {
                up = (index == 0) ? null : arr[index - 1]
                down = (index == arr.length - 1) ? null : arr[index + 1]
            }
            return item.id == id
        })
        if (condition.browse) {
            switch (type) {//goods产品、content文章、product商品、text信息、 carousel轮播、 image图片
                case 'content':
                case 'goods':
                case 'product':
                case 'text':
                case 'carousel':
                case 'image':
                    // 浏览量记录（URLSearchParams 作为 body 时自动携带 application/x-www-form-urlencoded，与原 jQuery.post 一致）
                    fetch('https://jzt2.china9.cn/api/readnum/addRead', {
                        method: 'POST',
                        body: new URLSearchParams({ id: id, type: api })
                    }).catch(function () { });
                    break;
            }
        }
    }

    total = newData.length
    last_page = limit > -1 ? Math.ceil(total / limit) : 1;
    if (limit > -1) newData = newData.slice((page - 1) * limit, limit * page)

    if (api != 'category' && api != 'navigation' && type != 'navigation') {
        var cateLists = []
        cateLists = filterDataList('category', { column_id, sort: sort, limit: -1, data_type: 'list' }, cateJson)
        newData.forEach(item => {
            if (item.category_id) {
                var cateNew = cateLists.filter(items => item.category_id.split(',').includes(items.id))
                if (cateNew.length > 0) {
                    var pCate = cateNew.concat(parentTree(cateNew[0].pid))
                    pCate.reverse().forEach((item_, index) => {
                        if (item_.pid == 0) {
                            item_.level = 1
                        } else if (index > 0) {
                            if (item_.pid == pCate[index - 1].pid) {
                                item_.level = pCate[index - 1].level
                            } else {
                                item_.level = pCate[index - 1].level + 1
                            }
                        }
                    })
                    item.category = Array.from(new Set(pCate.reverse()))
                }
            }
        })

        // 递归获取父分类
        function parentTree(pid) {
            var tree_ = []
            var list_ = cateLists.filter(item => {
                return item.id == pid
            })
            if (list_ && list_.length > 0) {
                tree_ = tree_.concat(list_)
                list_.forEach(item => {
                    tree_ = tree_.concat(parentTree(item.pid))
                })
            }
            return tree_
        }
    }
    if (data_type == 'page') {
        return {
            total,
            last_page,
            data: newData
        }
    }
    if (data_type == 'list') {
        return newData
    }
    if (data_type == 'show') {
        return {
            up,
            down,
            info: total > 0 ? newData[0] : {}
        }
    }
}

/**
 * 日期格式转换
 * @param {String} time 时间戳
 * @param {String} format 日期格式 例：Y-m-d h:i:s
 * Y-m-d h:i:s 转换为2021-09-01 12:30:30
 * m-d h:i:s 转换为09-01 12:30:30
 * m-d h:i 转换为09-01 12:30
 * Y年m月d日h时i分s秒 转换为2021年09月01日12时30分30秒
 */
function timeStamp2String(time, format) {
    const dateTime = new Date()
    dateTime.setTime(time)
    if (time.toString().length == 10) {
        dateTime.setTime(time * 1000)
    }
    const year = dateTime.getFullYear()
    const month = dateTime.getMonth() + 1 < 10 ? '0' + (dateTime.getMonth() + 1) : dateTime.getMonth() + 1
    const date = dateTime.getDate() < 10 ? '0' + dateTime.getDate() : dateTime.getDate()
    const hour = dateTime.getHours() < 10 ? '0' + dateTime.getHours() : dateTime.getHours()
    const minute = dateTime.getMinutes() < 10 ? '0' + dateTime.getMinutes() : dateTime.getMinutes()
    const second = dateTime.getSeconds() < 10 ? '0' + dateTime.getSeconds() : dateTime.getSeconds()
    // 返回字符串格式
    var dateInfo = ''
    const yIndex = format.search('Y')
    const mIndex = format.search('m')
    const dIndex = format.search('d')
    const hIndex = format.search('h')
    const iIndex = format.search('i')
    const sIndex = format.search('s')
    dateInfo += `${str(year, yIndex)}`
    dateInfo += `${str(month, mIndex)}`
    dateInfo += `${str(date, dIndex)}`
    dateInfo += `${str(hour, hIndex)}`
    dateInfo += `${str(minute, iIndex)}`
    dateInfo += `${str(second, sIndex)}`
    return dateInfo

    function str(number, index) {
        if (index > -1) return `${number}${format.slice(index + 1, index + 2)}`
        else return ''
    }
}

//获取地址栏参数//可以是中文参数
function getUrlParam(key) {
    // 获取参数
    var url = window.location.search;
    // 正则筛选地址栏
    var reg = new RegExp("(^|&)" + key + "=([^&]*)(&|$)");
    // 匹配目标参数
    var result = url.substr(1).match(reg);
    //返回参数值
    return result ? decodeURIComponent(result[2]) : null;
}


// 动态修改网站信息
function changeWebInfo(siteInfo) {
    /* 修改网站标题 */
    document.title = siteInfo.title
    /* 修改网站简介 */
    var $desc = document.querySelector('meta[name="description"]');
    if ($desc !== null) {
        $desc.content = siteInfo.description;
    } else {
        $desc = document.createElement("meta");
        $desc.name = "description";
        $desc.content = siteInfo.description;
        document.head.appendChild($desc);
    }
    /* 修改网站关键词 */
    var $keywords = document.querySelector('meta[name="keywords"]');
    if ($keywords !== null) {
        $keywords.content = siteInfo.keywords;
    } else {
        $keywords = document.createElement("meta");
        $keywords.name = "keywords";
        $keywords.content = siteInfo.keywords;
        document.head.appendChild($keywords);
    }
    /* 修改ico */
    var $favicon = document.querySelector('link[rel="icon"]');
    if ($favicon !== null) {
        $favicon.href = siteInfo.icon;
    } else {
        $favicon = document.createElement("link");
        $favicon.rel = "icon";
        $favicon.href = siteInfo.icon;
        document.head.appendChild($favicon);
    }
}

function Base64() {
    // private property
    var _keyStr = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    // public method for encoding
    this.encode = function (input) {
        var output = "";
        var chr1, chr2, chr3, enc1, enc2, enc3, enc4;
        var i = 0;
        input = _utf8_encode(input);
        while (i < input.length) {
            chr1 = input.charCodeAt(i++);
            chr2 = input.charCodeAt(i++);
            chr3 = input.charCodeAt(i++);
            enc1 = chr1 >> 2;
            enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
            enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
            enc4 = chr3 & 63;
            if (isNaN(chr2)) {
                enc3 = enc4 = 64;
            } else if (isNaN(chr3)) {
                enc4 = 64;
            }
            output = output +
                _keyStr.charAt(enc1) + _keyStr.charAt(enc2) +
                _keyStr.charAt(enc3) + _keyStr.charAt(enc4);
        }
        return output;
    }
    // public method for decoding
    this.decode = function (input) {
        var output = "";
        var chr1, chr2, chr3;
        var enc1, enc2, enc3, enc4;
        var i = 0;
        input = input.replace(/[^A-Za-z0-9\+\/\=]/g, "");
        while (i < input.length) {
            enc1 = _keyStr.indexOf(input.charAt(i++));
            enc2 = _keyStr.indexOf(input.charAt(i++));
            enc3 = _keyStr.indexOf(input.charAt(i++));
            enc4 = _keyStr.indexOf(input.charAt(i++));
            chr1 = (enc1 << 2) | (enc2 >> 4);
            chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
            chr3 = ((enc3 & 3) << 6) | enc4;
            output = output + String.fromCharCode(chr1);
            if (enc3 != 64) {
                output = output + String.fromCharCode(chr2);
            }
            if (enc4 != 64) {
                output = output + String.fromCharCode(chr3);
            }
        }
        output = _utf8_decode(output);
        return output;
    }
    // private method for UTF-8 encoding
    var _utf8_encode = function (string) {
        string = string.replace(/\r\n/g, "\n");
        var utftext = "";
        for (var n = 0; n < string.length; n++) {
            var c = string.charCodeAt(n);
            if (c < 128) {
                utftext += String.fromCharCode(c);
            } else if ((c > 127) && (c < 2048)) {
                utftext += String.fromCharCode((c >> 6) | 192);
                utftext += String.fromCharCode((c & 63) | 128);
            } else {
                utftext += String.fromCharCode((c >> 12) | 224);
                utftext += String.fromCharCode(((c >> 6) & 63) | 128);
                utftext += String.fromCharCode((c & 63) | 128);
            }
        }
        return utftext;
    }
    // private method for UTF-8 decoding
    var _utf8_decode = function (utftext) {
        var string = "";
        var i = 0;
        var c = 0, c1 = 0, c2 = 0, c3 = 0;
        while (i < utftext.length) {
            c = utftext.charCodeAt(i);
            if (c < 128) {
                string += String.fromCharCode(c);
                i++;
            } else if ((c > 191) && (c < 224)) {
                c2 = utftext.charCodeAt(i + 1);
                string += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
                i += 2;
            } else {
                c2 = utftext.charCodeAt(i + 1);
                c3 = utftext.charCodeAt(i + 2);
                string += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
                i += 3;
            }
        }
        return string;
    }
}

// 运行时自定义 JSON 数据目录（如数据放在其它路径或 CDN 时，在首次 requestData 之前调用）
function setBaseUrl(url) {
    baseUrl = url
}

export {
    timeStamp2String,
    getUrlParam,
    changeWebInfo,
    Base64,
    requestData,
    setBaseUrl
}