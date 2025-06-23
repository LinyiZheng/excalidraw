import polyfill from "../packages/excalidraw/polyfill";
import LanguageDetector from "i18next-browser-languagedetector";
import React,{ useEffect, useRef, useState } from "react";
import { trackEvent } from "../packages/excalidraw/analytics";
import { clearAppStateForDatabase, getDefaultAppState } from "../packages/excalidraw/appState";
import { ErrorDialog } from "../packages/excalidraw/components/ErrorDialog";
import { TopErrorBoundary } from "./components/TopErrorBoundary";
import {
  APP_NAME,
  EVENT,
  THEME,
  TITLE_TIMEOUT,
  VERSION_TIMEOUT,
} from "../packages/excalidraw/constants";
import { loadFromBlob } from "../packages/excalidraw/data/blob";
import {
  ExcalidrawElement,
  FileId,
  NonDeletedExcalidrawElement,
  Theme,
} from "../packages/excalidraw/element/types";
import { useCallbackRefState } from "../packages/excalidraw/hooks/useCallbackRefState";
import { t } from "../packages/excalidraw/i18n";
import {
  Excalidraw,
  defaultLang,
  LiveCollaborationTrigger,
  TTDDialog,
  TTDDialogTrigger,
} from "../packages/excalidraw/index";
import {
  AppState,
  LibraryItems,
  ExcalidrawImperativeAPI,
  BinaryFiles,
  ExcalidrawInitialDataState,
  UIAppState,
  SocketId,
  Collaborator
} from "../packages/excalidraw/types";
import {
  debounce,
  getVersion,
  getFrame,
  isTestEnv,
  preventUnload,
  ResolvablePromise,
  resolvablePromise,
  isRunningInIframe,
} from "../packages/excalidraw/utils";
import {
  FIREBASE_STORAGE_PREFIXES,
  STORAGE_KEYS,
  SYNC_BROWSER_TABS_TIMEOUT,
} from "./app_constants";
import Collab, {
  CollabAPI,
  collabAPIAtom,
  collabDialogShownAtom,
  isCollaboratingAtom,
  isOfflineAtom,
} from "./collab/Collab";
import {
  exportToBackend,
  getCollaborationLinkData,
  isCollaborationLink,
  loadScene,
} from "./data";
import {
  getLibraryItemsFromStorage,
  importFromLocalStorage,
  importUsernameFromLocalStorage,
} from "./data/localStorage";
import CustomStats from "./CustomStats";
import {
  restore,
  restoreAppState,
  RestoredDataState,
} from "../packages/excalidraw/data/restore";
import {
  ExportToExcalidrawPlus,
  exportToExcalidrawPlus,
} from "./components/ExportToExcalidrawPlus";
import { updateStaleImageStatuses } from "./data/FileManager";
import { newElementWith } from "../packages/excalidraw/element/mutateElement";
import { isInitializedImageElement } from "../packages/excalidraw/element/typeChecks";
import { loadFilesFromFirebase } from "./data/firebase";
import { LocalData } from "./data/LocalData";
import { isBrowserStorageStateNewer } from "./data/tabSync";
import clsx from "clsx";
import { reconcileElements } from "./collab/reconciliation";
import {
  parseLibraryTokensFromUrl,
  useHandleLibrary,
} from "../packages/excalidraw/data/library";
import { AppMainMenu } from "./components/AppMainMenu";
import { AppWelcomeScreen } from "./components/AppWelcomeScreen";
import { AppFooter } from "./components/AppFooter";
import { atom, Provider, useAtom, useAtomValue } from "jotai";
import { useAtomWithInitialValue } from "../packages/excalidraw/jotai";
import { appJotaiStore } from "./app-jotai";

import "./index.scss";
import { ResolutionType } from "../packages/excalidraw/utility-types";
import { ShareableLinkDialog } from "../packages/excalidraw/components/ShareableLinkDialog";
import { openConfirmModal } from "../packages/excalidraw/components/OverwriteConfirm/OverwriteConfirmState";
import { OverwriteConfirmDialog } from "../packages/excalidraw/components/OverwriteConfirm/OverwriteConfirm";
import Trans from "../packages/excalidraw/components/Trans";
import { JSEncrypt } from "jsencrypt"

//add by linyi
import { Card } from "../packages/excalidraw/components/Card";
import { ExcalidrawLogo } from "../packages/excalidraw/components/ExcalidrawLogo";
import { ToolButton } from "../packages/excalidraw/components/ToolButton";

polyfill();

window.EXCALIDRAW_THROTTLE_RENDER = true;

let isSelfEmbedding = false;

if (window.self !== window.top) {
  try {
    const parentUrl = new URL(document.referrer);
    const currentUrl = new URL(window.location.href);
    if (parentUrl.origin === currentUrl.origin) {
      isSelfEmbedding = true;
    }
  } catch (error) {
    // ignore
  }
}

const languageDetector = new LanguageDetector();
languageDetector.init({
  languageUtils: {},
});

const shareableLinkConfirmDialog = {
  title: t("overwriteConfirm.modal.shareableLink.title"),
  description: (
    <Trans
      i18nKey="overwriteConfirm.modal.shareableLink.description"
      bold={(text) => <strong>{text}</strong>}
      br={() => <br />}
    />
  ),
  actionLabel: t("overwriteConfirm.modal.shareableLink.button"),
  color: "danger",
} as const;

const initializeScene = async (opts: {
  collabAPI: CollabAPI | null;
  excalidrawAPI: ExcalidrawImperativeAPI;
}): Promise<
  { scene: ExcalidrawInitialDataState | null } & (
    | { isExternalScene: true; id: string; key: string }
    | { isExternalScene: false; id?: null; key?: null }
  )
> => {
  const searchParams = new URLSearchParams(window.location.search);
  const id = searchParams.get("id");
  const jsonBackendMatch = window.location.hash.match(
    /^#json=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/,
  );
  const externalUrlMatch = window.location.hash.match(/^#url=(.*)$/);

  const localDataState = importFromLocalStorage();

  let scene: RestoredDataState & {
    scrollToContent?: boolean;
  } = await loadScene(null, null, localDataState);

  let roomLinkData = getCollaborationLinkData(window.location.href);
  const isExternalScene = !!(id || jsonBackendMatch || roomLinkData);
  if (isExternalScene) {
    if (
      // don't prompt if scene is empty
      !scene.elements.length ||
      // don't prompt for collab scenes because we don't override local storage
      roomLinkData ||
      // otherwise, prompt whether user wants to override current scene
      (await openConfirmModal(shareableLinkConfirmDialog))
    ) {
      if (jsonBackendMatch) {
        scene = await loadScene(
          jsonBackendMatch[1],
          jsonBackendMatch[2],
          localDataState,
        );
      }
      scene.scrollToContent = true;
      if (!roomLinkData) {
        window.history.replaceState({}, APP_NAME, window.location.origin);
      }
    } else {
      // https://github.com/excalidraw/excalidraw/issues/1919
      if (document.hidden) {
        return new Promise((resolve, reject) => {
          window.addEventListener(
            "focus",
            () => initializeScene(opts).then(resolve).catch(reject),
            {
              once: true,
            },
          );
        });
      }

      roomLinkData = null;
      window.history.replaceState({}, APP_NAME, window.location.origin);
    }
  } else if (externalUrlMatch) {
    window.history.replaceState({}, APP_NAME, window.location.origin);

    const url = externalUrlMatch[1];
    try {
      const request = await fetch(window.decodeURIComponent(url));
      const data = await loadFromBlob(await request.blob(), null, null);
      if (
        !scene.elements.length ||
        (await openConfirmModal(shareableLinkConfirmDialog))
      ) {
        return { scene: data, isExternalScene };
      }
    } catch (error: any) {
      return {
        scene: {
          appState: {
            errorMessage: t("alerts.invalidSceneUrl"),
          },
        },
        isExternalScene,
      };
    }
  }

  if (roomLinkData && opts.collabAPI) {
    const { excalidrawAPI } = opts;

    const scene = await opts.collabAPI.startCollaboration(roomLinkData);

    return {
      // when collaborating, the state may have already been updated at this
      // point (we may have received updates from other clients), so reconcile
      // elements and appState with existing state
      scene: {
        ...scene,
        appState: {
          ...restoreAppState(
            {
              ...scene?.appState,
              theme: localDataState?.appState?.theme || scene?.appState?.theme,
            },
            excalidrawAPI.getAppState(),
          ),
          // necessary if we're invoking from a hashchange handler which doesn't
          // go through App.initializeScene() that resets this flag
          isLoading: false,
        },
        elements: reconcileElements(
          scene?.elements || [],
          excalidrawAPI.getSceneElementsIncludingDeleted(),
          excalidrawAPI.getAppState(),
        ),
      },
      isExternalScene: true,
      id: roomLinkData.roomId,
      key: roomLinkData.roomKey,
    };
  } else if (scene) {
    return isExternalScene && jsonBackendMatch
      ? {
          scene,
          isExternalScene,
          id: jsonBackendMatch[1],
          key: jsonBackendMatch[2],
        }
      : { scene, isExternalScene: false };
  }
  return { scene: null, isExternalScene: false };
};

const detectedLangCode = languageDetector.detect() || defaultLang.code;
export const appLangCodeAtom = atom(
  Array.isArray(detectedLangCode) ? detectedLangCode[0] : detectedLangCode,
);

// Auth 工具函数 add by linyi
function getToken(username:string): string | null {
  return localStorage.getItem(`${username}_token`);
}
function setToken(username:string,token: string) {
  // console.info(token)
  localStorage.setItem(`${username}_token`, token);
}
function logout() {
  localStorage.removeItem("token");
  window.location.href = "/login";
}

// 后端交互方法 add by linyi
async function apiMe(username:string): Promise<{username:string,token:string}> {
  const userToken = getToken(username);
  // console.info(userToken)
  if (!userToken) throw new Error("no token");
  // console.info(userToken)
  const res = await fetch(`/api/me?username=${username}`, {
    method:"GET",
    headers: { Authorization: `Bearer ${userToken}` },
    credentials:"include"
    
  });
  if (!res.ok) throw new Error("unauthorized");
  const {token} = await res.json();
  return {
    username:username,
    token:token
  };
}

// add by linyi
async function apiLogin(username: string, password: string): Promise<string> {
  //获取公钥
  const keyres = await fetch("/api/publickey",{
    method:"GET",
    credentials:"include",
    headers:{ "Content-Type": "application/json" }
  })
  const {publickey} = await keyres.json();
  // console.info(publickey)
  const encryptor = new JSEncrypt();
  encryptor.setPublicKey(`-----BEGIN PUBLIC KEY-----\n${publickey}\n-----END PUBLIC KEY-----`);
  const encryptPassword = encryptor.encrypt(password);


  const res = await fetch("/api/login", {
    method: "POST",
    credentials:"include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      "username":username, 
      "password":encryptPassword })
  });
  if (!res.ok) throw new Error("login failed");
  const json = await res.json();
  return json.token;
}
async function apiLoad(username:string): Promise<ExcalidrawInitialDataState | null> {
  const token = getToken(username);
  const res = await fetch(`/api/load?username=${username}`, {
    method:"GET",
    credentials:"include",
    headers: {
      "Content-Type":"application/json",
      "Access-Control-Allow-Credentials":"true",
      Authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) return null;
  const json=await res.json()
  if (json===null) return null;
  else{
    const drawData=json.data;
    // console.info(drawData);
    const data:ExcalidrawInitialDataState = JSON.parse(drawData);

    // add by linyi 将保存的数据恢复出来
    return {
      elements:data.elements,
      appState:clearAppStateForDatabase(data.appState ?? {})
    }
  }    
}
async function apiSave(username:string,drawData: ExcalidrawInitialDataState) {
  const token = getToken(username);
  const data = JSON.stringify(drawData);
  const res=await fetch("/api/save", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({username,data})
                  });
  // console.info(res.status);
  return res.status;
}

const ExcalidrawWrapper = () => {
  const [errorMessage, setErrorMessage] = useState("");
  const [langCode, setLangCode] = useAtom(appLangCodeAtom);
  const isCollabDisabled = isRunningInIframe();

  // add by linyi
  const [path, setPath] = useState(window.location.pathname);
  const [user, setUser] = useState<{username:string,token:string}>();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [initialData, setInitialData] = useState<ExcalidrawInitialDataState | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);


  // initial state
  // ---------------------------------------------------------------------------

  const initialStatePromiseRef = useRef<{
    promise: ResolvablePromise<ExcalidrawInitialDataState | null>;
  }>({ promise: null! });
  if (!initialStatePromiseRef.current.promise) {
    initialStatePromiseRef.current.promise =
      resolvablePromise<ExcalidrawInitialDataState | null>();
  }

  useEffect(() => {
    trackEvent("load", "frame", getFrame());
    // Delayed so that the app has a time to load the latest SW
    setTimeout(() => {
      trackEvent("load", "version", getVersion());
    }, VERSION_TIMEOUT);
  }, []);

  const [excalidrawAPI, excalidrawRefCallback] =
    useCallbackRefState<ExcalidrawImperativeAPI>();

  const [collabAPI] = useAtom(collabAPIAtom);
  const [, setCollabDialogShown] = useAtom(collabDialogShownAtom);
  const [isCollaborating] = useAtomWithInitialValue(isCollaboratingAtom, () => {
    return isCollaborationLink(window.location.href);
  });

  useHandleLibrary({
    excalidrawAPI,
    getInitialLibraryItems: getLibraryItemsFromStorage,
  });

  useEffect(() => {
    if (!excalidrawAPI || (!isCollabDisabled && !collabAPI)) {
      return;
    }

    const loadImages = (
      data: ResolutionType<typeof initializeScene>,
      isInitialLoad = false,
    ) => {
      if (!data.scene) {
        return;
      }
      if (collabAPI?.isCollaborating()) {
        if (data.scene.elements) {
          collabAPI
            .fetchImageFilesFromFirebase({
              elements: data.scene.elements,
              forceFetchFiles: true,
            })
            .then(({ loadedFiles, erroredFiles }) => {
              excalidrawAPI.addFiles(loadedFiles);
              updateStaleImageStatuses({
                excalidrawAPI,
                erroredFiles,
                elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
              });
            });
        }
      } else {
        const fileIds =
          data.scene.elements?.reduce((acc, element) => {
            if (isInitializedImageElement(element)) {
              return acc.concat(element.fileId);
            }
            return acc;
          }, [] as FileId[]) || [];

        if (data.isExternalScene) {
          loadFilesFromFirebase(
            `${FIREBASE_STORAGE_PREFIXES.shareLinkFiles}/${data.id}`,
            data.key,
            fileIds,
          ).then(({ loadedFiles, erroredFiles }) => {
            excalidrawAPI.addFiles(loadedFiles);
            updateStaleImageStatuses({
              excalidrawAPI,
              erroredFiles,
              elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
            });
          });
        } else if (isInitialLoad) {
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
          // on fresh load, clear unused files from IDB (from previous
          // session)
          LocalData.fileStorage.clearObsoleteFiles({ currentFileIds: fileIds });
        }
      }
    };

    initializeScene({ collabAPI, excalidrawAPI }).then(async (data) => {
      loadImages(data, /* isInitialLoad */ true);
      initialStatePromiseRef.current.promise.resolve(data.scene);
    });

    const onHashChange = async (event: HashChangeEvent) => {
      event.preventDefault();
      const libraryUrlTokens = parseLibraryTokensFromUrl();
      if (!libraryUrlTokens) {
        if (
          collabAPI?.isCollaborating() &&
          !isCollaborationLink(window.location.href)
        ) {
          collabAPI.stopCollaboration(false);
        }
        excalidrawAPI.updateScene({ appState: { isLoading: true } });

        initializeScene({ collabAPI, excalidrawAPI }).then((data) => {
          loadImages(data);
          if (data.scene) {
            excalidrawAPI.updateScene({
              ...data.scene,
              ...restore(data.scene, null, null, { repairBindings: true }),
              commitToHistory: true,
            });
          }
        });
      }
    };

    const titleTimeout = setTimeout(
      () => (document.title = APP_NAME),
      TITLE_TIMEOUT,
    );

    const syncData = debounce(() => {
      if (isTestEnv()) {
        return;
      }
      if (
        !document.hidden &&
        ((collabAPI && !collabAPI.isCollaborating()) || isCollabDisabled)
      ) {
        // don't sync if local state is newer or identical to browser state
        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_DATA_STATE)) {
          const localDataState = importFromLocalStorage();
          const username = importUsernameFromLocalStorage();
          let langCode = languageDetector.detect() || defaultLang.code;
          if (Array.isArray(langCode)) {
            langCode = langCode[0];
          }
          setLangCode(langCode);
          excalidrawAPI.updateScene({
            ...localDataState,
          });
          excalidrawAPI.updateLibrary({
            libraryItems: getLibraryItemsFromStorage(),
          });
          collabAPI?.setUsername(username || "");
        }

        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_FILES)) {
          const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
          const currFiles = excalidrawAPI.getFiles();
          const fileIds =
            elements?.reduce((acc, element) => {
              if (
                isInitializedImageElement(element) &&
                // only load and update images that aren't already loaded
                !currFiles[element.fileId]
              ) {
                return acc.concat(element.fileId);
              }
              return acc;
            }, [] as FileId[]) || [];
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
        }
      }
    }, SYNC_BROWSER_TABS_TIMEOUT);

    const onUnload = () => {
      LocalData.flushSave();
    };

    const visibilityChange = (event: FocusEvent | Event) => {
      if (event.type === EVENT.BLUR || document.hidden) {
        LocalData.flushSave();
      }
      if (
        event.type === EVENT.VISIBILITY_CHANGE ||
        event.type === EVENT.FOCUS
      ) {
        syncData();
      }
    };

    window.addEventListener(EVENT.HASHCHANGE, onHashChange, false);
    window.addEventListener(EVENT.UNLOAD, onUnload, false);
    window.addEventListener(EVENT.BLUR, visibilityChange, false);
    document.addEventListener(EVENT.VISIBILITY_CHANGE, visibilityChange, false);
    window.addEventListener(EVENT.FOCUS, visibilityChange, false);
    return () => {
      window.removeEventListener(EVENT.HASHCHANGE, onHashChange, false);
      window.removeEventListener(EVENT.UNLOAD, onUnload, false);
      window.removeEventListener(EVENT.BLUR, visibilityChange, false);
      window.removeEventListener(EVENT.FOCUS, visibilityChange, false);
      document.removeEventListener(
        EVENT.VISIBILITY_CHANGE,
        visibilityChange,
        false,
      );
      clearTimeout(titleTimeout);
    };
  }, [isCollabDisabled, collabAPI, excalidrawAPI, setLangCode]);

  useEffect(() => {
    const unloadHandler = (event: BeforeUnloadEvent) => {
      LocalData.flushSave();

      if (
        excalidrawAPI &&
        LocalData.fileStorage.shouldPreventUnload(
          excalidrawAPI.getSceneElements(),
        )
      ) {
        preventUnload(event);
      }
    };
    window.addEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    return () => {
      window.removeEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    };
  }, [excalidrawAPI]);

  useEffect(() => {
    languageDetector.cacheUserLanguage(langCode);
  }, [langCode]);

  const [theme, setTheme] = useState<Theme>(
    () =>
      (localStorage.getItem(
        STORAGE_KEYS.LOCAL_STORAGE_THEME,
      ) as Theme | null) ||
      // FIXME migration from old LS scheme. Can be removed later. #5660
      importFromLocalStorage().appState?.theme ||
      THEME.LIGHT,
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.LOCAL_STORAGE_THEME, theme);
    // currently only used for body styling during init (see public/index.html),
    // but may change in the future
    document.documentElement.classList.toggle("dark", theme === THEME.DARK);
  }, [theme]);

  const onChange = (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (collabAPI?.isCollaborating()) {
      collabAPI.syncElements(elements);
    }

    setTheme(appState.theme);

    // this check is redundant, but since this is a hot path, it's best
    // not to evaludate the nested expression every time
    if (!LocalData.isSavePaused()) {
      LocalData.save(elements, appState, files, () => {
        if (excalidrawAPI) {
          let didChange = false;

          const elements = excalidrawAPI
            .getSceneElementsIncludingDeleted()
            .map((element) => {
              if (
                LocalData.fileStorage.shouldUpdateImageElementStatus(element)
              ) {
                const newElement = newElementWith(element, { status: "saved" });
                if (newElement !== element) {
                  didChange = true;
                }
                return newElement;
              }
              return element;
            });

          if (didChange) {
            excalidrawAPI.updateScene({
              elements,
            });
          }
        }
      });
    }
  };

  const [latestShareableLink, setLatestShareableLink] = useState<string | null>(
    null,
  );

  const onExportToBackend = async (
    exportedElements: readonly NonDeletedExcalidrawElement[],
    appState: Partial<AppState>,
    files: BinaryFiles,
    canvas: HTMLCanvasElement,
  ) => {
    if (exportedElements.length === 0) {
      throw new Error(t("alerts.cannotExportEmptyCanvas"));
    }
    if (canvas) {
      try {
        const { url, errorMessage } = await exportToBackend(
          exportedElements,
          {
            ...appState,
            viewBackgroundColor: appState.exportBackground
              ? appState.viewBackgroundColor
              : getDefaultAppState().viewBackgroundColor,
          },
          files,
        );

        if (errorMessage) {
          throw new Error(errorMessage);
        }

        if (url) {
          setLatestShareableLink(url);
        }
      } catch (error: any) {
        if (error.name !== "AbortError") {
          const { width, height } = canvas;
          console.error(error, { width, height });
          throw new Error(error.message);
        }
      }
    }
  };

  const renderCustomStats = (
    elements: readonly NonDeletedExcalidrawElement[],
    appState: UIAppState,
  ) => {
    return (
      <CustomStats
        setToast={(message) => excalidrawAPI!.setToast({ message })}
        appState={appState}
        elements={elements}
      />
    );
  };

  const onLibraryChange = async (items: LibraryItems) => {
    if (!items.length) {
      localStorage.removeItem(STORAGE_KEYS.LOCAL_STORAGE_LIBRARY);
      return;
    }
    const serializedItems = JSON.stringify(items);
    localStorage.setItem(STORAGE_KEYS.LOCAL_STORAGE_LIBRARY, serializedItems);
  };

  const isOffline = useAtomValue(isOfflineAtom);


  // add by linyi
  // 路由变化监听
  useEffect(() => {
    const onNav = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onNav);
    return () => window.removeEventListener("popstate", onNav);
  }, []);

  // 登录状态保护 add by linyi
  useEffect(() => {
    if (path === "/login") return;

    // 先获取本地token,未取到token，直接跳转登录页
    const userToken = getToken(username);
    if(!userToken){
      window.location.href = "/login";
      return;
    }

    //token不为空时，执行apiMe判断
    apiMe(username)
      .then((user)=> {
        setUser(user);
        setIsLoggedIn(true);
      })
      .catch(() => logout());
  }, [path]);

  // 用户登录后只加载一次数据
  useEffect(()=>{
    if(isLoggedIn && user && user.username){
      // console.info('user:',user)
      // console.info('username:',user.username)
      apiLoad(user.username).then(data =>{
        if(Array.isArray(data?.elements)){
          setInitialData(data);
        }else{
          console.info("server result data:",data);
          console.error("服务端返回的数据中,elements元素不是数组");
        }
                                          });
    }
  },[user])

  // 只有用户主动编辑 ，才进行保存
  // useEffect(() => {
  //   const handleUserInteract = () => setHasUserInteracted(true);
  //   window.addEventListener("mousedown",handleUserInteract,{once:true});
  //   window.addEventListener("keydown",handleUserInteract,{once:true});
  //   window.addEventListener("touchstart",handleUserInteract,{once:true});
  //   return ()=> {
  //     window.removeEventListener("mousedown",handleUserInteract);
  //     window.removeEventListener("keydown",handleUserInteract);
  //     window.removeEventListener("touchstart",handleUserInteract);
  //   }
  // }, []);

  // // 只在 initialData 加载后，第一次 onChange 时设置 hasInitialized
  // useEffect(() => {
  //   if (initialData && !hasInitialized) {
  //     setHasInitialized(true);
  //   }
  // }, [initialData]);

  // 登录页面 add by linyi
  if (path === "/login") {
    const doLogin = async (e:React.FormEvent) => {
      e.preventDefault();
      try {
        const token = await apiLogin(username, password);
        setToken(username,token);
        setIsLoggedIn(true);
        // alert("doLogin:"+token)
        window.history.pushState(null, "", "/");
        setPath("/");
      } catch (e) {
        alert(e)
        alert("登录失败");
      }
    };

    const backgroundStyle = {
      display: "flex",
      justifyContent: "center",
      alignItems: ",center",
      height: "100vh",
      padding:"100px"
      // backgroundImage: 'url("/background.jpg")',
      // backgroundSize: 'cover',
      // backgroundPosition: 'center',
      
    };

    const formStyle = {
      backgroundColor: "rgba(255, 255, 255, 0.9)",
      padding: "60px",
      borderRadius: "10px",
      boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
      minWidth: "300px",
      maxWidth: "500px",     // 新增最大宽度
      width: "100%",         // 自适应容器
    };

    const buttonStyle = {
      display: "block",
      width: "35%",
      margin: "0 auto",
      padding: "15px",
      fontSize: "15px",
      backgroundColor: "#4CAF50",
      color: "white",
      border: "none",
      borderRadius: "6px",
      cursor: "pointer",
    };

    const inputStyle = {
      display: "block",
      margin: "0 auto",
      width: "50%",
      padding: "15px",
      marginBottom: "20px",
      fontSize: "15px",
      borderRadius: "6px",
      border: "1px solid #ccc",
    };

    return (
      <div style={backgroundStyle}>
        <form style={formStyle} onSubmit={doLogin}>
          <h2 style={{ textAlign: "center", marginBottom: "20px" }}>登录</h2>
          <input type="text" name="username" placeholder="用户名" value={username} onChange={e => setUsername(e.target.value)} style={inputStyle}/><br />
          <input type="password" name="password" placeholder="密码" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle}/><br />
          <button type="submit" style={buttonStyle}>登录</button>
        </form>
      </div>
    );
  }

  // 编辑页面加载中
  if (!user) return <div>加载中用户信息...</div>;

  // browsers generally prevent infinite self-embedding, there are
  // cases where it still happens, and while we disallow self-embedding
  // by not whitelisting our own origin, this serves as an additional guard
  if (isSelfEmbedding) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          height: "100%",
        }}
      >
        <h1>I'm not a pretzel!</h1>
      </div>
    );
  }

  return (
      <div style={{ height: "100%",display: "flex", flexDirection: "column" }} className={clsx("excalidraw-app", {"is-collaborating": isCollaborating,})}>
        <div style={{ padding: 8, display: "flex", justifyContent: "space-between" }}>
          <div>{user.username}</div><button onClick={logout}>退出</button>
        </div>
      {/* <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </BrowserRouter> */}
      <Excalidraw
        excalidrawAPI={excalidrawRefCallback}
        onChange={onChange}
        // initialData={initialStatePromiseRef.current.promise}
        initialData={initialData??initialStatePromiseRef.current.promise}
        // onChange={(elements,appState)=>{
        //   // if(!hasUserInteracted) return;
        //   apiSave(username,{elements,appState});
        // }}
        isCollaborating={isCollaborating}
        onPointerUpdate={collabAPI?.onPointerUpdate}
        UIOptions={{
          canvasActions: {
            toggleTheme: true,
            export: {
              onExportToBackend,
              renderCustomUI: (elements, appState, files) => {
                return (
                  <>
                    {/* 增加保存到服务器的按钮 */}
                    <Card color="primary">
                      <div className="Card-icon">
                        <ExcalidrawLogo
                          style={{
                            [`--color-logo-icon` as any]: "#fff",
                            width: "2.8rem",
                            height: "2.8rem",
                          }}
                        />
                      </div>
                      <h2>保存到云端</h2>
                      <div className="Card-details">
                        {t("exportDialog.server_title")}
                      </div>
                      <ToolButton
                        className="Card-button"
                        type="button"
                        title={t("exportDialog.server_button")}
                        aria-label={t("exportDialog.server_button")}
                        showAriaLabel={true}
                        onClick={async () => {
                          try {
                            // trackEvent("export", "eplus", `ui (${getFrame()})`);
                            // onSuccess();
                            const saveRes=await apiSave(user.username,{elements,appState});
                            if(saveRes === 200){
                            alert("成功保存到服务器");
                            }
                          } catch (error: any) {
                            console.error(error);
                            if (error.name !== "AbortError") {
                              alert("保存服务器异常，请先本地保存，稍后重试保存服务器");
                            }
                          }
                        }}
                      />
                    </Card>
                    {/* 保留原来的保存到 ExcalidrawPlus + */}
                    {/* <ExportToExcalidrawPlus
                      elements={elements}
                      appState={appState}
                      files={files}
                      onError={(error) => {
                        excalidrawAPI?.updateScene({
                          appState: {
                            errorMessage: error.message,
                          },
                        });
                      }}
                      onSuccess={() => {
                        excalidrawAPI?.updateScene({
                          appState: { openDialog: null },
                        });
                      }}
                    /> */}
                  </>
                );//
              },
            },
          },
        }}
        langCode={langCode}
        renderCustomStats={renderCustomStats}
        detectScroll={false}
        handleKeyboardGlobally={true}
        onLibraryChange={onLibraryChange}
        autoFocus={true}
        theme={theme}
        renderTopRightUI={(isMobile) => {
          if (isMobile || !collabAPI || isCollabDisabled) {
            return null;
          }
          return (
            <LiveCollaborationTrigger
              isCollaborating={isCollaborating}
              onSelect={() => setCollabDialogShown(true)}
            />
          );
        }}
      >
        <AppMainMenu
          setCollabDialogShown={setCollabDialogShown}
          isCollaborating={isCollaborating}
          isCollabEnabled={!isCollabDisabled}
        />
        <AppWelcomeScreen
          setCollabDialogShown={setCollabDialogShown}
          isCollabEnabled={!isCollabDisabled}
        />
        <OverwriteConfirmDialog>
          <OverwriteConfirmDialog.Actions.ExportToImage />
          <OverwriteConfirmDialog.Actions.SaveToDisk />
          <OverwriteConfirmDialog.Actions.SaveToServer />
          {excalidrawAPI && (
            <OverwriteConfirmDialog.Action
              title={t("overwriteConfirm.action.excalidrawPlus.title")}
              actionLabel={t("overwriteConfirm.action.excalidrawPlus.button")}
              onClick={() => {
                exportToExcalidrawPlus(
                  excalidrawAPI.getSceneElements(),
                  excalidrawAPI.getAppState(),
                  excalidrawAPI.getFiles(),
                );
              }}
            >
              {t("overwriteConfirm.action.excalidrawPlus.description")}
            </OverwriteConfirmDialog.Action>
          )}
        </OverwriteConfirmDialog>
        <AppFooter />
        <TTDDialog
          onTextSubmit={async (input) => {
            try {
              const response = await fetch(
                `${
                  import.meta.env.VITE_APP_AI_BACKEND
                }/v1/ai/text-to-diagram/generate`,
                {
                  method: "POST",
                  headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ prompt: input }),
                },
              );

              const rateLimit = response.headers.has("X-Ratelimit-Limit")
                ? parseInt(response.headers.get("X-Ratelimit-Limit") || "0", 10)
                : undefined;

              const rateLimitRemaining = response.headers.has(
                "X-Ratelimit-Remaining",
              )
                ? parseInt(
                    response.headers.get("X-Ratelimit-Remaining") || "0",
                    10,
                  )
                : undefined;

              const json = await response.json();

              if (!response.ok) {
                if (response.status === 429) {
                  return {
                    rateLimit,
                    rateLimitRemaining,
                    error: new Error(
                      "Too many requests today, please try again tomorrow!",
                    ),
                  };
                }

                throw new Error(json.message || "Generation failed...");
              }

              const generatedResponse = json.generatedResponse;
              if (!generatedResponse) {
                throw new Error("Generation failed...");
              }

              return { generatedResponse, rateLimit, rateLimitRemaining };
            } catch (err: any) {
              throw new Error("Request failed");
            }
          }}
        />
        <TTDDialogTrigger />
        {isCollaborating && isOffline && (
          <div className="collab-offline-warning">
            {t("alerts.collabOfflineWarning")}
          </div>
        )}
        {latestShareableLink && (
          <ShareableLinkDialog
            link={latestShareableLink}
            onCloseRequest={() => setLatestShareableLink(null)}
            setErrorMessage={setErrorMessage}
          />
        )}
        {excalidrawAPI && !isCollabDisabled && (
          <Collab excalidrawAPI={excalidrawAPI} />
        )}
        {errorMessage && (
          <ErrorDialog onClose={() => setErrorMessage("")}>
            {errorMessage}
          </ErrorDialog>
        )}
      </Excalidraw>
    </div>
  );
};

// // 挂载 App.tsx
// createRoot(document.getElementById("root")!).render(<ExcalidrawWrapper />);

const ExcalidrawApp = () => {
  return (
    <TopErrorBoundary>
      <Provider unstable_createStore={() => appJotaiStore}>
        <ExcalidrawWrapper />
      </Provider>
    </TopErrorBoundary>
  );
};

export default ExcalidrawApp;