/* ========================= 类型定义 ========================= */

/**
 * CMS 数据实体（开放式）
 *
 * 建站通后台的字段随站点配置浮动（不同栏目返回的字段并不一致），
 * 因此这里只声明各接口共有的稳定字段，其余通过索引签名放行。
 */
export interface DataItem {
    id: string
    title?: string
    /** 原始为 'YYYY-MM-DD HH:mm:ss' 字符串，filterDataList 会就地转成毫秒时间戳 */
    create_time?: string | number
    update_time?: string
    /** 多分类以英文逗号分隔 */
    category_id?: string
    /** 分类/导航的父级 id，顶级为 '0' */
    pid?: string
    sort?: number
    type?: string
    column_id?: string
    site_id?: string
    intro?: string
    details?: string
    bg_img?: string
    /** 1 表示置顶 */
    is_top?: number
    status?: number
    /** filterDataList 回填：该条数据所属的分类链（由子到父） */
    category?: DataItem[]
    /** childTree 在 list_type='children' 时回填的子分类 */
    children?: DataItem[]
    /** parentTree/childTree 回填的层级，顶级为 1 */
    level?: number

    [key: string]: any
}

/** site.json：站点全局信息（对象而非数组） */
export interface SiteInfo {
    id: string
    site_id: string
    title: string
    keywords: string
    description: string
    icon: string
    company_title?: string
    company_desc?: string
    company_address?: string
    company_keep?: string
    company_phone?: string
    company_tel?: string
    company_email?: string
    pc_logo?: string
    phone_logo?: string

    [key: string]: any
}

/** 排序方式：时间/排序号 × 正序/倒序 */
export type SortType = 'timeAsc' | 'timeDesc' | 'sortAsc' | 'sortDesc'

/** 返回格式 */
export type DataType = 'page' | 'list' | 'show'

/** 分类取值范围：alone 仅当前分类 / all 含全部子级（扁平） / children 子级递归成树 */
export type ListType = 'all' | 'alone' | 'children'

/** 数据筛选条件 */
export interface RequestCondition {
    /** 数据返回格式，默认 'page' */
    data_type?: DataType
    /** 当前页，默认 1 */
    page?: number
    /** 每页条数，默认 10；取全部传 -1 */
    limit?: number
    /** 分类 id 筛选，多个以英文逗号分隔 */
    category_id?: string
    /** 数据 id 筛选（配合 data_type='show' 取详情与上下条） */
    id?: string
    /** 排序方式 */
    sort?: SortType
    /** 分类取值范围，默认 'alone' */
    list_type?: ListType
    /** 类型筛选：goods 产品 / content 文章 / text 信息 / carousel 轮播 / image 图片 / navigation 导航 */
    type?: string
    /** 栏目 ID（从制作端查看） */
    column_id?: string
    /** 标题模糊查找 */
    search_name?: string
    /** 精确匹配（=）而非包含匹配 */
    exact_search?: boolean
    /** 搜索前统一转小写 */
    search_to_lowerCase?: boolean
    /** 搜索范围扩展到 intro 与 details */
    search_in_intro_detail?: boolean
    /** 统计阅读量（仅 data_type='show' 取详情时有效） */
    browse?: boolean
    /** 'session' 时数据缓存进 sessionStorage */
    method?: 'session' | string
}

/** data_type='page' 的返回结构 */
export interface PageResult<T = DataItem> {
    /** 筛选后总条数 */
    total: number
    /** 总页数（limit 为 -1 时恒为 1） */
    last_page: number
    data: T[]
}

/** data_type='show' 的返回结构 */
export interface ShowResult<T = DataItem> {
    /** 上一条；无上一条为 null，未命中 id 时该键不存在 */
    up?: T | null
    /** 下一条；无下一条为 null，未命中 id 时该键不存在 */
    down?: T | null
    /** 详情，未命中时为空对象 */
    info: T | Record<string, never>
}

/**
 * 按 data_type 分派 requestData 的返回类型
 *
 * 之所以用条件类型而非重载：condition 常以对象字面量内联传入，
 * 条件类型能在推断出字面量类型 'list' / 'show' 时直接收窄，
 * 调用方不必写任何断言。未显式指定 data_type 时落到默认的 PageResult。
 */
export type FilterResult<C extends RequestCondition, T = DataItem> =
    C extends { data_type: 'list' } ? T[]
        : C extends { data_type: 'show' } ? ShowResult<T>
            : PageResult<T>

/** requestData 的旧式回调签名（保留兼容） */
export type RequestCallback<R = any> = (result: R) => void

/* ========================= 实现 ========================= */

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
var jsonArr: Record<string, string> = {}
// 进行中的请求（api -> Promise）：同一 api 的并发调用复用同一次请求，替代原 requestList/requestWait 排队机制
var requestPromises: Record<string, Promise<string>> = {}
// 分类数据（category.json 解析结果），filterDataList 递归查询分类树时依赖
var cateJson: DataItem[]

/* 请求数据（async/await 版）
 * 返回 Promise，可直接 await 拿到结果：const res = await requestData('site')
 * 第 3 个参数 callBack 保留，兼容旧回调写法：requestData('site', null, res => {...})
 * 原第 4 个参数 async 已废弃（fetch 恒为异步），传入会被忽略
 */
// 重载 1：不传 data —— 直接返回 JSON 原文（如 site.json 是对象、goods.json 是数组）
async function requestData<R = any>(api: string): Promise<R>
// 重载 2：传 data —— 走 filterDataList，返回类型由 data_type 决定
async function requestData<C extends RequestCondition, T = DataItem>(
    api: string,
    data: C,
    callBack?: RequestCallback<FilterResult<C, T>>
): Promise<FilterResult<C, T>>
async function requestData(
    api: string,
    data: RequestCondition | null = null,
    callBack?: RequestCallback
): Promise<any> {
    // filterDataList 依赖分类数据，先确保 category 就绪
    cateJson = JSON.parse(await loadJson('category', data))
    var response = JSON.parse(await loadJson(api, data))
    var result = data ? filterDataList(api, data, response) : response
    if (typeof callBack === 'function') callBack(result)
    return result
}

// 获取缓存数据
function getData(api: string, data: RequestCondition | null): string | undefined {
    var result: string | undefined | null
    if (data && data.method == 'session' && typeof window !== 'undefined') result = window.sessionStorage.getItem(api) || jsonArr[api]
    else result = jsonArr[api]
    return result ?? undefined
}

// 加载 JSON 字符串：缓存命中直接返回；未命中时复用进行中的请求，或发起新请求
function loadJson(api: string, data: RequestCondition | null): Promise<string> {
    var cached = getData(api, data)
    if (cached) return Promise.resolve(cached)
    if (!requestPromises[api]) {
        requestPromises[api] = fetchJson(api, data).catch(function (error: unknown) {
            // 请求失败：清掉占位，允许后续调用重试，避免永久挂起
            delete requestPromises[api]
            console.error('[jzt_common] 加载 ' + api + '.json 失败:', error)
            throw error
        })
    }
    return requestPromises[api]
}

// 实际请求：SSR/SSG 环境读取文件系统，浏览器环境用 fetch；写入缓存并返回 JSON 字符串
async function fetchJson(api: string, data: RequestCondition | null): Promise<string> {
    var url = baseUrl + api + '.json?v=' + Date.now()
    var result: unknown

    if (typeof window === 'undefined' && url.startsWith('/')) {
        // SSR/SSG：动态导入 Node.js 模块（仅在服务端可用），直接读取 public 目录
        const [pathModule, fsModule] = await Promise.all([import('path'), import('fs')])
        var publicDir = pathModule.resolve(process.cwd(), 'public')
        var filePath = pathModule.join(publicDir, url.split('?')[0]!)
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
 *
 * 比较表达式刻意保持原样（不补 `?? 0`）：字段缺失时相减得 NaN，
 * 会被 Array.prototype.sort 当作「不调整顺序」，这是原有的既定行为。
 */
function dataSort<T extends DataItem>(sort: SortType | undefined, arr: T[]): T[] {
    if (sort) {
        arr.sort(function (a, b) {
            //a,b表示相邻的两个元素
            //若返回值>0,数组元素将按升序排列
            //若返回值<0,数组元素将按降序排列
            switch (sort) {
                case 'sortAsc':
                    return a.sort! - b.sort!
                case 'sortDesc':
                    return b.sort! - a.sort!
                case 'timeAsc':
                    return (a.create_time as number) - (b.create_time as number)
                case 'timeDesc':
                    return (b.create_time as number) - (a.create_time as number)
                // 未知排序值：返回 0 表示不调整顺序。
                // 原实现在此隐式返回 undefined，是非法的 comparator 返回值。
                default:
                    return 0
            }
        })
    }
    return arr
}

/**
 * 数据列表处理
 */
function filterDataList(api: string, condition: RequestCondition, data: DataItem[]): any {
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
    var up: DataItem | null | undefined, down: DataItem | null | undefined
    var search_to_lowerCase = condition.search_to_lowerCase || false // 是否开启大小写转换
    var search_in_intro_detail = condition.search_in_intro_detail || false // 是否开启从简介和详情中搜索

    // 栏目id筛选
    if (column_id) {
        newData = newData.filter(item => item.column_id == column_id)
    }

    // 日期处理：'YYYY-MM-DD HH:mm:ss' -> 毫秒时间戳
    // 注意此处的 try/catch 是承重的：cateJson 等数据在同一次请求内会被反复复用，
    // 第二次进来时 create_time 已是 number，.replace 抛错被吞掉从而保持原值不变（幂等）。
    // 不要改成 String(item.create_time)——那样不会抛错，会把时间戳解析成 Invalid Date。
    newData.forEach(item => {
        try { item.create_time = new Date((item.create_time as string).replace(/-/g, '/')).getTime() }
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
                return item.category_id!.split(',').some(item => category_id!.split(',').includes(item))
            }
        })
    }
    if (category_id && (list_type == 'all' || list_type == 'children')) {
        var cateList: DataItem[] = [], cateList_: DataItem[] = [];

        var type_category = condition.type || api
        if (api == 'category' || type == 'navigation') type_category = type!
        if (api == 'navigation') type_category = 'navigation'

        cateList = filterDataList('category', { type: type_category, column_id, sort: sort, limit: -1, data_type: 'list' }, cateJson)
        // if(api === 'navigation') console.log(cateList, 'cateList')
        cateList_ = cateList.filter(item => {
            return item.id == category_id
        })
        if (list_type == 'children' && cateList_.length > 0) {
            cateList_ = childTree(cateList_[0]!.id)
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
        function childTree(pid: string): DataItem[] {
            var tree: DataItem[] = []
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
        newData.forEach(item => { item.title = item.title!.toString() })
        if (search_to_lowerCase) {
            search_name = search_name.toLowerCase();
            if (search_in_intro_detail) {
                if (exact_search) {
                    newData = newData.filter(item => item.title!.toLowerCase() === search_name || item.intro!.toLowerCase() === search_name || item.details!.toLowerCase() === search_name)
                } else {
                    newData = newData.filter(item => item.title!.toLowerCase().includes(search_name!) || item.intro!.toLowerCase().includes(search_name!) || item.details!.toLowerCase().includes(search_name!))
                }
            } else {
                if (exact_search) {
                    newData = newData.filter(item => item.title!.toLowerCase() === search_name)
                } else {
                    newData = newData.filter(item => item.title!.toLowerCase().includes(search_name!))
                }
            }
        } else {
            if (search_in_intro_detail) {
                if (exact_search) {
                    newData = newData.filter(item => item.title === search_name || item.intro === search_name || item.details === search_name)
                } else {
                    newData = newData.filter(item => item.title!.includes(search_name!) || item.intro!.includes(search_name!) || item.details!.includes(search_name!))
                }
            } else {
                if (exact_search) {
                    newData = newData.filter(item => item.title === search_name)
                } else {
                    newData = newData.filter(item => item.title!.includes(search_name!))
                }
            }
        }
    }
    if (id) {
        newData = newData.filter((item, index, arr) => {
            if (item.id == id) {
                up = (index == 0) ? null : arr[index - 1]!
                down = (index == arr.length - 1) ? null : arr[index + 1]!
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
        var cateLists: DataItem[] = []
        cateLists = filterDataList('category', { column_id, sort: sort, limit: -1, data_type: 'list' }, cateJson)
        newData.forEach(item => {
            if (item.category_id) {
                var cateNew = cateLists.filter(items => item.category_id!.split(',').includes(items.id))
                if (cateNew.length > 0) {
                    var pCate = cateNew.concat(parentTree(cateNew[0]!.pid!))
                    pCate.reverse().forEach((item_, index) => {
                        // 保留原有的宽松比较：pid 为 '0' 或 '' 时都判为顶级。
                        // pid 声明为 string，与 0 比较需先转型，等价于原 JS 的 == 语义。
                        if ((item_.pid as unknown as number) == 0) {
                            item_.level = 1
                        } else if (index > 0) {
                            if (item_.pid == pCate[index - 1]!.pid) {
                                item_.level = pCate[index - 1]!.level
                            } else {
                                item_.level = pCate[index - 1]!.level! + 1
                            }
                        }
                    })
                    item.category = Array.from(new Set(pCate.reverse()))
                }
            }
        })

        // 递归获取父分类
        function parentTree(pid: string): DataItem[] {
            var tree_: DataItem[] = []
            var list_ = cateLists.filter(item => {
                return item.id == pid
            })
            if (list_ && list_.length > 0) {
                tree_ = tree_.concat(list_)
                list_.forEach(item => {
                    tree_ = tree_.concat(parentTree(item.pid!))
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
        } satisfies PageResult
    }
    if (data_type == 'list') {
        return newData
    }
    if (data_type == 'show') {
        return {
            up,
            down,
            info: total > 0 ? newData[0]! : {}
        } satisfies ShowResult
    }
}

/**
 * 日期格式转换
 * @param time 时间戳（秒或毫秒，长度为 10 时按秒处理）
 * @param format 日期格式 例：Y-m-d h:i:s
 * Y-m-d h:i:s 转换为2021-09-01 12:30:30
 * m-d h:i:s 转换为09-01 12:30:30
 * m-d h:i 转换为09-01 12:30
 * Y年m月d日h时i分s秒 转换为2021年09月01日12时30分30秒
 */
function timeStamp2String(time: number | string, format: string): string {
    const dateTime = new Date()
    dateTime.setTime(Number(time))
    if (time.toString().length == 10) {
        dateTime.setTime(Number(time) * 1000)
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

    function str(number: number | string, index: number): string {
        if (index > -1) return `${number}${format.slice(index + 1, index + 2)}`
        else return ''
    }
}

//获取地址栏参数//可以是中文参数
function getUrlParam(key: string): string | null {
    // 获取参数
    var url = window.location.search;
    // 正则筛选地址栏
    var reg = new RegExp("(^|&)" + key + "=([^&]*)(&|$)");
    // 匹配目标参数（slice(1) 去掉开头的 '?'，等价于原 substr(1)，后者已废弃）
    var result = url.slice(1).match(reg);
    //返回参数值
    return result ? decodeURIComponent(result[2]!) : null;
}


// 动态修改网站信息
function changeWebInfo(siteInfo: SiteInfo): void {
    /* 修改网站标题 */
    document.title = siteInfo.title
    /* 修改网站简介 */
    var $desc = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if ($desc !== null) {
        $desc.content = siteInfo.description;
    } else {
        $desc = document.createElement("meta");
        $desc.name = "description";
        $desc.content = siteInfo.description;
        document.head.appendChild($desc);
    }
    /* 修改网站关键词 */
    var $keywords = document.querySelector<HTMLMetaElement>('meta[name="keywords"]');
    if ($keywords !== null) {
        $keywords.content = siteInfo.keywords;
    } else {
        $keywords = document.createElement("meta");
        $keywords.name = "keywords";
        $keywords.content = siteInfo.keywords;
        document.head.appendChild($keywords);
    }
    /* 修改ico */
    var $favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if ($favicon !== null) {
        $favicon.href = siteInfo.icon;
    } else {
        $favicon = document.createElement("link");
        $favicon.rel = "icon";
        $favicon.href = siteInfo.icon;
        document.head.appendChild($favicon);
    }
}

/**
 * Base64 编解码
 *
 * 原为 `function Base64() { this.encode = ... }` 老式构造函数，
 * 改写为 class：既消除隐式 this，也保持 `new Base64().encode(str)` 的调用方式不变。
 */
class Base64 {
    // private property
    private static readonly _keyStr = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

    // public method for encoding
    public encode(input: string): string {
        const _keyStr = Base64._keyStr;
        var output = "";
        var chr1: number, chr2: number, chr3: number, enc1: number, enc2: number, enc3: number, enc4: number;
        var i = 0;
        input = Base64._utf8_encode(input);
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
    public decode(input: string): string {
        const _keyStr = Base64._keyStr;
        var output = "";
        var chr1: number, chr2: number, chr3: number;
        var enc1: number, enc2: number, enc3: number, enc4: number;
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
        output = Base64._utf8_decode(output);
        return output;
    }

    // private method for UTF-8 encoding
    private static _utf8_encode(string: string): string {
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
    private static _utf8_decode(utftext: string): string {
        var string = "";
        var i = 0;
        var c = 0, c2 = 0, c3 = 0;
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
function setBaseUrl(url: string): void {
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
