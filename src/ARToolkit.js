import ModuleLoader from './ModuleLoader';
import Utils from './Utils';

const UNKNOWN_MARKER = -1;
const PATTERN_MARKER = 0;
const BARCODE_MARKER = 1;
const NFT_MARKER = 2;

export default class ARToolkit {

  static get UNKNOWN_MARKER() { return UNKNOWN_MARKER; }
  static get PATTERN_MARKER() { return PATTERN_MARKER; }
  static get BARCODE_MARKER() { return BARCODE_MARKER; }
  static get NFT_MARKER() { return NFT_MARKER; }
  static INSTANCE;

  /**
   * Deafult constructor.
   */
  constructor() {

    // reference to WASM module
    this.instance;

    this.markerCount = 0;
    this.multiMarkerCount = 0;
    this.cameraCount = 0;
    this.version = '0.3.0'
    console.info('ARToolkit ', this.version)
  }
  //----------------------------------------------------------------------------

  // initialization
  /**
   * Init the ARToolKit space with all the Emscripten instanced methods. 
   * It creates also a global artoolkit variable.
   * @returns {ARToolkit}
   */
  async init() {

    const runtime = await ModuleLoader.init();
    this.instance = runtime.instance;
    this._decorate();

    // we're committing a cardinal sin here by exporting the instance into
    // the global namespace. all blame goes to the person who created that CPP
    // wrapper ARToolKitJS.cpp and introduced a global "artoolkit" variable.
    let scope = (typeof window !== 'undefined') ? window : global;
    scope['artoolkit'] = this;
    ARToolkit.INSTANCE = this.instance;

    return this;
  }

  _decorate() {

    // add delegate methods
    [
      'setup', 'teardown',
      'setupAR2',
      'setLogLevel', 'getLogLevel',
      'setDebugMode', 'getDebugMode',
      'getProcessingImage',
      'setMarkerInfoDir', 'setMarkerInfoVertex',
      'getTransMatSquare', 'getTransMatSquareCont',
      'getTransMatMultiSquare', 'getTransMatMultiSquareRobust',
      'getMultiMarkerNum', 'getMultiMarkerCount',
      'detectMarker', 'getMarkerNum',
      'detectNFTMarker',
      'getNFTMarker', 'getNFTData', 'getMarker',
      'getMultiEachMarker',
      'setProjectionNearPlane', 'getProjectionNearPlane',
      'setProjectionFarPlane', 'getProjectionFarPlane',
      'setThresholdMode', 'getThresholdMode',
      'setThreshold', 'getThreshold',
      'setPatternDetectionMode', 'getPatternDetectionMode',
      'setMatrixCodeType', 'getMatrixCodeType',
      'setLabelingMode', 'getLabelingMode',
      'setPattRatio', 'getPattRatio',
      'setImageProcMode', 'getImageProcMode',
    ].forEach(method => {
      this[method] = this.instance[method];
    });

    // expose constants
    for (let co in this.instance) {
      if (co.match(/^AR/)) {
        this[co] = this.instance[co];
      }
    }
  }
  //----------------------------------------------------------------------------

  // public accessors
  /**
   * Load the camera parameter file. You need to provide a valid url.
   * @param {string} urlOrData 
   * @returns 
   */
  async loadCamera(urlOrData) {

    const target = '/camera_param_' + this.cameraCount++;

    let data;

    if (urlOrData instanceof Uint8Array) {
      // assume preloaded camera params
      data = urlOrData;
    } else {
      // fetch data via HTTP
      try { data = await Utils.fetchRemoteData(urlOrData); }
      catch (error) { throw error; }
    }

    this._storeDataFile(data, target);

    // return the internal marker ID
    return this.instance._loadCamera(target);
  }

  /**
   * Add a Marker to ARToolkit instance. Used by the ARController class. 
   * It is preferred to use loadMarker instead with a new ARcontroller instance.
   * @param {number} arId 
   * @param {string} urlOrData 
   * @returns {number} 
   */
  async addMarker(arId, urlOrData) {

    const target = '/marker_' + this.markerCount++;

    let data;

    if (urlOrData.indexOf("\n") !== -1) {
      // assume text from a .patt file
      data = Utils.string2Uint8Data(urlOrData);
    } else {
      // fetch data via HTTP
      try { data = await Utils.fetchRemoteData(urlOrData); }
      catch (error) { throw error; }
    }

    this._storeDataFile(data, target);

    // return the internal marker ID
    return this.instance._addMarker(arId, target);
  }

  /**
   * Add a multi marker config file. Used by the ARController class. 
   * It is preferred to use loadMultiMarker instead with a new ARcontroller instance.
   * @param {number} arId 
   * @param {string} url 
   * @param {function} callback called on success, it return the id of the marker and the number of markers in the config file.
   * @param {function} onError callback
   * @returns {Promise}
   */
  async addMultiMarker(arId, url, callback, onError) {
    const filename = '/multi_marker_' + this.multiMarkerCount++;

    ARToolkit.ajax(url, filename, function (bytes) {

      let files = Utils.parseMultiFile(bytes);

      function ok() {
        const markerID =  ARToolkit.INSTANCE._addMultiMarker(arId, filename);
        const markerNum =  ARToolkit.INSTANCE.getMultiMarkerNum(arId, markerID);
        if (callback) callback(markerID, markerNum);
      }

      if (!files.length) return ok();

      const path = url.split('/').slice(0, -1).join('/');
      files = files.map(function (file) {
        return [path + '/' + file, file]
      });
      ARToolkit.ajaxDependencies(files, ok);
    }, function (error) { if (onError) onError(error) });
  }


  /**
   * Add a NFT marker file. You need to provide the url of the marker without the extension. 
   * Used by the ARController class. 
   * It is preferred to use loadNFTMarker instead with a new ARcontroller instance.
   * @param {number} arId 
   * @param {string} url 
   * @returns {number}
   */
  async addNFTMarker(arId, url) {
    // url doesn't need to be a valid url. Extensions to make it valid will be added here
    const targetPrefix = '/markerNFT_' + this.markerCount++;
    const extensions = ['fset', 'iset', 'fset3'];

    const storeMarker = async function (ext) {
      const fullUrl = url + '.' + ext;
      const target = targetPrefix + '.' + ext;
      const data = await Utils.fetchRemoteData(fullUrl);
      this._storeDataFile(data, target);
    };

    const promises = extensions.map(storeMarker, this);
    await Promise.all(promises);

    // return the internal marker ID
    return this.instance._addNFTMarker(arId, targetPrefix);
  }
  //----------------------------------------------------------------------------

  // implementation
  /**
   * ajax function used by the addMultiMarker method
   */
  static ajax(url, target, callback, errorCallback, prefix) {
    const oReq = new XMLHttpRequest();
    oReq.open('GET', url, true);
    oReq.responseType = 'arraybuffer'; // blob arraybuffer
    const writeByteArrayToFS = (target, byteArray, callback, prefix) => {
      ARToolkit.INSTANCE.FS.writeFile(target, byteArray, { encoding: 'binary' });
      // console.log('FS written', target);
      callback(byteArray, prefix);
    }

    oReq.onload = function () {
      if (this.status == 200) {
        // console.log('ajax done for ', url);
        const arrayBuffer = oReq.response;
        const byteArray = new Uint8Array(arrayBuffer);
        writeByteArrayToFS(target, byteArray, callback, prefix);
      }
      else {
        errorCallback(this.status);
      }
    };

    oReq.send();
  }

  /**
   * ajax dependencies used by the addMultiMarker method
   * @param {*} files 
   * @param {*} callback
   * @returns {void}
   */
  static ajaxDependencies(files, callback) {
    const next = files.pop();
    if (next) {
      ARToolkit.ajax(next[0], next[1], function () {
        ARToolkit.ajaxDependencies(files, callback);
      });
    } else {
      callback();
    }
  }


  _storeDataFile(data, target) {
    // FS is provided by emscripten
    // Note: valid data must be in binary format encoded as Uint8Array
    this.instance.FS.writeFile(target, data, {
      encoding: 'binary'
    });
  }
  //----------------------------------------------------------------------------
}